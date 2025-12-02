/* eslint-env mocha */
'use strict'

const lunr = require('lunr')
const { expect } = require('./harness')

/**
 * Minimal reproduction of the search fallback logic used by the browser client
 * to validate that queries like `vk_nv_copy` behave the same as `vk_nv_cop`.
 *
 * We can’t import the browser bundle in Node tests (it depends on DOM APIs),
 * so we test the normalization and wildcard behavior against a tiny Lunr index.
 */

function normalizeWildcardTerm (index, term) {
  const s = typeof term === 'string' ? term : String(term)
  const lower = s.toLowerCase()
  // If the query contains delimiters like '_' or '-', prefer stemming the last segment
  // so that inputs like 'vk_nv_copy' normalize to 'copi' instead of the whole token.
  const hasDelim = /[_-]/.test(lower)

  const runPipeline = (str) => {
    try {
      const tokens = index && index.pipeline && typeof index.pipeline.runString === 'function'
        ? index.pipeline.runString(str)
        : null
      if (tokens && tokens.length) {
        // Prefer the last token (often the stem) else the longest token
        let candidate = tokens[tokens.length - 1]
        if (candidate.length < 3) candidate = tokens.reduce((a, b) => (b.length > a.length ? b : a), candidate)
        return candidate || str
      }
    } catch (_) {}
    return str
  }

  if (hasDelim) {
    const parts = lower.split(/[_-]+/).filter(Boolean)
    const last = parts.length ? parts[parts.length - 1] : lower
    return runPipeline(last)
  }

  try {
    const tokens = index && index.pipeline && typeof index.pipeline.runString === 'function'
      ? index.pipeline.runString(lower)
      : null
    if (tokens && tokens.length) {
      let candidate = tokens[tokens.length - 1]
      if (candidate.length < 3) candidate = tokens.reduce((a, b) => (b.length > a.length ? b : a), candidate)
      return candidate || lower
    }
  } catch (_) {}
  return lower
}

function executeSearchWithWildcards (index, queryString) {
  // Phase 1: exact (pipeline-enabled via QueryParser)
  let parsedQuery
  let result = index.query(function (lunrQuery) {
    const parser = new lunr.QueryParser(queryString, lunrQuery)
    parser.parse()
    parsedQuery = lunrQuery
  })
  if (result.length > 0) return result

  // Phase 2: begins-with (pipeline bypassed, but terms are normalized/stemmed beforehand)
  result = index.query(function (lunrQuery) {
    lunrQuery.clauses = parsedQuery.clauses.map((clause) => {
      if (clause.presence !== lunr.Query.presence.PROHIBITED) {
        const term = normalizeWildcardTerm(index, clause.term)
        clause.term = term + '*'
        clause.wildcard = lunr.Query.wildcard.TRAILING
        clause.usePipeline = false
      }
      return clause
    })
  })
  if (result.length > 0) return result

  // Phase 3: contains
  result = index.query(function (lunrQuery) {
    lunrQuery.clauses = parsedQuery.clauses.map((clause) => {
      if (clause.presence !== lunr.Query.presence.PROHIBITED) {
        const term = normalizeWildcardTerm(index, clause.term)
        clause.term = '*' + term + '*'
        clause.wildcard = lunr.Query.wildcard.LEADING | lunr.Query.wildcard.TRAILING
        clause.usePipeline = false
      }
      return clause
    })
  })
  return result
}

describe('Wildcard normalization for underscore-delimited tokens', () => {
  it('vk_nv_copy returns the same hit(s) as vk_nv_cop', () => {
    // Build a tiny index with a document that contains VK_NV_Copy in its fields
    const documents = [
      {
        id: '1',
        title: 'VK_NV_Copy overview',
        name: 'VK_NV_Copy',
        text: 'This page mentions VK_NV_Copy repeatedly to ensure tokenization with underscores.',
        component: 'spec',
        keyword: 'VK_NV_Copy',
      },
    ]

    const index = lunr(function () {
      this.ref('id')
      this.field('title', { boost: 10 })
      this.field('name')
      this.field('text')
      this.field('component')
      this.field('keyword', { boost: 5 })
      documents.forEach((doc) => this.add(doc))
    })

    const r1 = executeSearchWithWildcards(index, 'vk_nv_cop')
    const r2 = executeSearchWithWildcards(index, 'vk_nv_copy')

    // Both queries should produce at least one hit and refer to the same document IDs
    expect(r1.length, 'vk_nv_cop should produce hits').to.be.greaterThan(0)
    expect(r2.length, 'vk_nv_copy should produce hits').to.be.greaterThan(0)

    const refs1 = new Set(r1.map((it) => it.ref.split('-')[0]))
    const refs2 = new Set(r2.map((it) => it.ref.split('-')[0]))
    expect([...refs1]).to.deep.equal([...refs2])
    expect(refs1.has('1')).to.be.true()
  })

  it('incremental prefixes for underscore terms still produce hits', () => {
    const documents = [
      {
        id: '1',
        title: 'VK_NV_Copy overview',
        name: 'VK_NV_Copy',
        text: 'This page mentions VK_NV_Copy repeatedly to ensure tokenization with underscores.',
        component: 'spec',
        keyword: 'VK_NV_Copy',
      },
    ]

    const index = lunr(function () {
      this.ref('id')
      this.field('title', { boost: 10 })
      this.field('name')
      this.field('text')
      this.field('component')
      this.field('keyword', { boost: 5 })
      documents.forEach((doc) => this.add(doc))
    })

    const prefixes = ['vk', 'vk_', 'vk_n', 'vk_nv', 'vk_nv_', 'vk_nv_c', 'vk_nv_co', 'vk_nv_cop']
    for (const q of prefixes) {
      const r = executeSearchWithWildcards(index, q)
      expect(r.length, `prefix ${q} should yield at least one result`).to.be.greaterThan(0)
      const refs = new Set(r.map((it) => it.ref.split('-')[0]))
      expect(refs.has('1'), `prefix ${q} should include the VK_NV_Copy doc`).to.be.true()
    }
  })
})
