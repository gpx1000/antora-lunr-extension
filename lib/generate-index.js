'use strict'

const lunr = require('lunr')
const cheerio = require('cheerio')
const { decode } = require('html-entities')
const LevenshteinTrie = require('./levenshtein_patricia_trie')
const pako = require('pako')
/**
 * Generate a Lunr index.
 *
 * Iterates over the specified pages and creates a Lunr index.
 * Then creates a patricia trie index for levenshtein distance compare.
 *
 * @memberof lunr-extension
 *
 * @param {Object} playbook - The configuration object for Antora.
 * @param {Object} contentCatalog - The Antora content catalog, with pages and metadata.
 * @param {Object} [config={}] - Configuration options
 * @param {Boolean} config.indexLatestOnly - If true, only index the latest version of any given page.
 * @param {Array<String>} config.languages - List of index languages
 * @param {Object} config.logger - Logger to use
 * @typedef {Object} SearchIndexData
 * @property {lunr.Index} index - a Lunr index
 * @property {Object} store - the documents store
 * @returns {SearchIndexData} A data object that contains the Lunr index and documents store
 */
function generateIndex (playbook, contentCatalog, { indexLatestOnly = false, languages = ['en'], logger } = {}) {
  if (!logger) logger = process.env.NODE_ENV === 'test' ? { info: () => undefined } : console

  logger.info('Building search index with the language(s): %s', languages.join(', '))

  // Select indexable pages
  const pages = contentCatalog.getPages((page) => {
    if (!page.out || page.asciidoc?.attributes?.noindex != null) return
    if (indexLatestOnly) {
      const component = contentCatalog.getComponent(page.src.component)
      if (contentCatalog.getComponentVersion(component, page.src.version) !== component.latest) return
    }
    return true
  })
  if (!pages.length) return {}

  // Use short numerical identifiers (as ref) to keep the Lunr index as small as possible.
  // Since it's an identifier (and not an index) we start at 1.
  let id = 1
  // Extract document objects from indexable pages
  const documents = pages.reduce((accum, page) => {
    const $ = cheerio.load(page.contents)
    // Only index page if not marked as "noindex" by "robots" meta tag
    if (!$('meta[name=robots][content=noindex]').length) {
      accum.push({ id: id++, ...extractIndexContent(page, $) })
    }
    return accum
  }, [])

  if (languages.length > 1 || !languages.includes('en')) {
    if (languages.length > 1 && !lunr.multiLanguage) {
      // required, otherwise lunr.multiLanguage will be undefined
      require('lunr-languages/lunr.multi')(lunr)
    }
    // required, to load additional languages
    require('lunr-languages/lunr.stemmer.support')(lunr)
    languages.forEach((language) => {
      if (language === 'ja' && !lunr.TinySegmenter) {
        require('lunr-languages/tinyseg')(lunr) // needed for Japanese Support
      }
      if (language === 'th' && !lunr.wordcut) {
        lunr.wordcut = require('lunr-languages/wordcut') // needed for Thai support
      }
      if (language !== 'en' && !lunr[language]) {
        require(`lunr-languages/lunr.${language}`)(lunr)
      }
    })
  }

  // Map of Lunr ref (id) to document
  const store = {
    documents: {},
    components: {},
    trie: {},
  }

  // Construct the Lunr index from the extracted content
  const index = lunr(function () {
    if (languages.length > 1) {
      this.use(lunr.multiLanguage(...languages))
    } else if (!languages.includes('en')) {
      this.use(lunr[languages[0]])
    }
    this.ref('id')
    this.field('title', { boost: 10 })
    this.field('name')
    this.field('text')
    this.field('component')
    this.field('keyword', { boost: 5 })
    documents.forEach((doc) => {
      doc.titles.forEach((title) => {
        this.add({ id: `${doc.id}-${title.id}`, title: title.text })
      })
      this.add(doc)
      store.documents[doc.id] = doc
    })
  })

  store.trie = new LevenshteinTrie()
  documents.forEach((doc) => {
    doc.titles.forEach((title) => {
      const words = (title.text).toLowerCase().split(' ').join('_')
      store.trie.insertWithData(words, doc.id)
    })
  })

  const componentVersions = {}
  const components = contentCatalog.getComponents()
  for (const component of components) {
    for (const version of component.versions) {
      componentVersions[`${component.name}/${version.version}`] = version
    }
  }
  store.componentVersions = componentVersions

  return { index, store }
}

/**
 * Extract the index content for a given page.
 * @param {Object<Page>} page Full text input to clean irrelevant material from.
 * @param {*} $ Cheerio representation of the page.
 * @returns {Object} Indexable content for a given page.
 */
function extractIndexContent (page, $) {
  // Fetch just the article content, so we don't index the TOC and other on-page text
  // Remove any found headings, to improve search results
  const article = $('article.doc')
  const $h1 = $('h1', article)
  const documentTitle = $h1.first().text()
  $h1.remove()
  const titles = []
  const keywords = page.asciidoc.attributes?.keywords
  let id = 1
  $('h2,h3,h4,h5,h6', article).each(function () {
    const $title = $(this)
    titles.push({
      text: $title.text(),
      hash: $title.attr('id'),
      id: id++,
    })
    if (/\s/.test($title.text())) {
      titles.push({
        text: $title.text().split(' ').join('_'),
        hash: $title.attr('id'),
        id: id++,
      })
    }
    $title.remove()
  })

  // don't index navigation elements for pagination on each page
  // as these are the titles of other pages and it would otherwise pollute the index.
  $('nav.pagination', article).each(function () {
    $(this).remove()
  })

  // Pull the text from the article, and convert entities
  let text = article.text()
  // Decode HTML
  text = decode(text)
  // Strip HTML tags
  text = text
    .replace(/(<([^>]+)>)/gi, '')
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Return the indexable content, organized by type
  return {
    text: text,
    title: documentTitle,
    component: page.src.component,
    version: page.src.version,
    name: page.src.stem,
    url: page.pub.url,
    titles: titles, // TODO get title id to be able to use fragment identifier
    keyword: keywords,
  }
}

// Helper function allowing Antora to create a site asset containing the index
function createIndexFile (index) {
  let trieData = index.store.trie.save()
  trieData = pako.deflate(trieData)
  trieData = btoa(trieData.reduce((data, byte) => data + String.fromCharCode(byte), ''))
  let lunrData = JSON.stringify(index)
  lunrData = pako.deflate(lunrData)
  lunrData = btoa(lunrData.reduce((data, byte) => data + String.fromCharCode(byte), ''))
  return {
    mediaType: 'application/javascript',
    // eslint-disable-next-line no-useless-escape
    contents: Buffer.from(`antoraSearch.initSearch(lunr, \'${lunrData}\', \'${trieData}\')`),
    src: { stem: 'search-index' },
    out: { path: 'search-index.js' },
    pub: { url: '/search-index.js', rootPath: '' },
  }
}

// Helper function to create a markdown file from the index data for LLM MCP support
function createMarkdownIndexFile (index) {
  const documents = Object.values(index.store.documents)
  let markdownContent = '# Site Index\n\n'

  // Group documents by component and version
  const componentVersions = {}
  documents.forEach((doc) => {
    const key = `${doc.component}/${doc.version}`
    if (!componentVersions[key]) {
      componentVersions[key] = []
    }
    componentVersions[key].push(doc)
  })

  // Generate markdown content
  Object.entries(componentVersions).forEach(([componentVersion, docs]) => {
    const [component, version] = componentVersion.split('/')
    markdownContent += `## ${component} (${version})\n\n`

    docs.forEach((doc) => {
      markdownContent += `### [${doc.title}](${doc.url})\n\n`

      // Add section titles if available
      if (doc.titles && doc.titles.length > 0) {
        markdownContent += '#### Sections\n\n'
        const uniqueTitles = new Set()
        doc.titles.forEach((title) => {
          // Skip titles that are just underscored versions of other titles
          if (!title.text.includes('_') || !uniqueTitles.has(title.text.replace(/_/g, ' '))) {
            uniqueTitles.add(title.text)
            markdownContent += `- [${title.text}](${doc.url}#${title.hash})\n`
          }
        })
        markdownContent += '\n'
      }

      // Add keywords if available
      if (doc.keyword) {
        markdownContent += `**Keywords**: ${doc.keyword}\n\n`
      }

      // Add all the content
      if (doc.text) {
        markdownContent += `${doc.text}\n\n`
      }

      markdownContent += '---\n\n'
    })
  })

  return {
    mediaType: 'text/markdown',
    contents: Buffer.from(markdownContent),
    src: { stem: 'site-index' },
    out: { path: 'site-index.md' },
    pub: { url: '/site-index.md', rootPath: '' },
  }
}

module.exports = generateIndex
module.exports.createIndexFile = createIndexFile
module.exports.createMarkdownIndexFile = createMarkdownIndexFile
