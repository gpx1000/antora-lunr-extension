'use strict'

/**
 * Splitting the text by the given positions.
 * The text within the positions getting the type "mark", all other text gets the type "text".
 * @param {string} text
 * @param {Object[]} positions
 * @param {number} positions.start
 * @param {number} positions.length
 * @param {number} snippetLength Maximum text length for text in the result.
 * @returns {[{text: string, type: string}]}
 */
export function buildHighlightedText (text, positions, snippetLength) {
  const textLength = text.length
  const validPositions = positions
    .filter((position) => position.length > 0 && position.start + position.length <= textLength)

  if (validPositions.length === 0) {
    return [
      {
        type: 'text',
        text: text.slice(0, snippetLength >= textLength ? textLength : snippetLength) + (snippetLength < textLength ? '...' : ''),
      },
    ]
  }

  const orderedPositions = validPositions.sort((p1, p2) => p1.start - p2.start)
  const range = {
    start: 0,
    end: textLength,
  }
  const firstPosition = orderedPositions[0]
  if (snippetLength && text.length > snippetLength) {
    const firstPositionStart = firstPosition.start
    const firstPositionLength = firstPosition.length
    const firstPositionEnd = firstPositionStart + firstPositionLength

    range.start = firstPositionStart - snippetLength < 0 ? 0 : firstPositionStart - snippetLength
    range.end = firstPositionEnd + snippetLength > textLength ? textLength : firstPositionEnd + snippetLength
  }
  const nodes = []
  if (firstPosition.start > 0) {
    nodes.push({
      type: 'text',
      text: (range.start > 0 ? '...' : '') + text.slice(range.start, firstPosition.start),
    })
  }
  let lastEndPosition = 0
  const positionsWithinRange = orderedPositions
    .filter((position) => position.start >= range.start && position.start + position.length <= range.end)

  for (const position of positionsWithinRange) {
    const start = position.start
    const length = position.length
    const end = start + length
    if (lastEndPosition > 0) {
      // create text Node from the last end position to the start of the current position
      nodes.push({
        type: 'text',
        text: text.slice(lastEndPosition, start),
      })
    }
    nodes.push({
      type: 'mark',
      text: text.slice(start, end),
    })
    lastEndPosition = end
  }
  if (lastEndPosition < range.end) {
    nodes.push({
      type: 'text',
      text: text.slice(lastEndPosition, range.end) + (range.end < textLength ? '...' : ''),
    })
  }

  return nodes
}

/**
 * Taken and adapted from: https://github.com/olivernn/lunr.js/blob/aa5a878f62a6bba1e8e5b95714899e17e8150b38/lib/tokenizer.js#L24-L67
 * @param lunr
 * @param text
 * @param term
 * @return {{start: number, length: number}}
 */
export function findTermPosition (lunr, term, text, textLower) {
  // Use provided pre-lowercased text when available to avoid repeated allocations
  const str = textLower || text.toLowerCase()
  const t = typeof term === 'string' ? term.toLowerCase() : String(term)
  const index = str.indexOf(t)
  if (index === -1) return { start: 0, length: 0 }
  // Extend to the end of the token (stop at '.', ',' or whitespace) without regex
  let end = index + t.length
  const n = str.length
  while (end < n) {
    const ch = str.charCodeAt(end)
    // stop on period (.) 46, comma (,) 44 or any whitespace
    if (ch === 46 || ch === 44 || ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 160) break
    end++
  }
  return { start: index, length: end - index }
}

class TrieNode {
  constructor () {
    this.children = new Map()
    this.isEndOfWord = false
    this.data = [] // Store associated data (e.g., document IDs, URLs)
  }
}

export class LevenshteinTrieUser {
  constructor () {
    this.root = new TrieNode()
  }

  insert (word) {
    let node = this.root
    for (const char of word) {
      if (!node.children.has(char)) {
        node.children.set(char, new TrieNode())
      }
      node = node.children.get(char)
    }
    node.isEndOfWord = true
  }

  searchWithLevenshtein (word, maxDistance) {
    const results = []
    this._searchRecursive(this.root, '', word, 0, maxDistance, results)
    return results
  }

  _searchRecursive (node, currentWord, targetWord, currentIndex, maxDistance, results) {
    if (currentIndex > targetWord.length && node.isEndOfWord) {
      results.push(currentWord)
      return
    }
    if (maxDistance < 0) {
      return
    }

    if (node.isEndOfWord && this.levenshteinDistance(currentWord, targetWord) <= maxDistance) {
      results.push(currentWord)
    }

    for (const [char, childNode] of node.children) {
      let newDistance = maxDistance
      if (currentIndex < targetWord.length) {
        if (char === targetWord[currentIndex]) {
          this._searchRecursive(childNode, currentWord + char, targetWord, currentIndex + 1, newDistance, results)
        } else {
          newDistance = maxDistance - 1 //substitution
          this._searchRecursive(childNode, currentWord + char, targetWord, currentIndex + 1, newDistance, results)
          this._searchRecursive(node, currentWord, targetWord, currentIndex + 1, newDistance, results) //insertion
          this._searchRecursive(
            childNode,
            currentWord + char,
            targetWord,
            currentIndex,
            newDistance,
            results
          ) // deletion
        }
      } else {
        this._searchRecursive(childNode, currentWord + char, targetWord, currentIndex, newDistance - 1, results)
      }
    }
  }

  levenshteinDistance (a, b) {
    if (a.length === 0) return b.length
    if (b.length === 0) return a.length

    const matrix = []

    // increment along the first column of each row
    let i
    for (i = 0; i <= b.length; i++) {
      matrix[i] = [i]
    }

    // increment each column in the first row
    let j
    for (j = 0; j <= a.length; j++) {
      matrix[0][j] = j
    }

    // Fill in the rest of the matrix
    for (i = 1; i <= b.length; i++) {
      for (j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1]
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            Math.min(matrix[i][j - 1] + 1, // insertion
              matrix[i - 1][j] + 1) // deletion
          )
        }
      }
    }

    return matrix[b.length][a.length]
  }

  // Save the Trie to a JSON string
  save () {
    return JSON.stringify(this.root, (key, value) => {
      if (value instanceof Map) {
        return Array.from(value.entries()) // Convert Map to array of entries
      }
      return value
    })
  }

  // Load the Trie from a JSON string
  load (jsonString) {
    this.root = jsonString
    // this.root = JSON.parse(jsonString, (key, value) => {
    //   if (Array.isArray(value)) {
    //     return new Map(value) // Convert array of entries back to Map
    //   }
    //   return value
    // })
  }

  insertWithData (word, data) {
    let node = this.root
    for (const char of word) {
      if (!node.children.has(char)) {
        node.children.set(char, new TrieNode())
      }
      node = node.children.get(char)
    }
    node.isEndOfWord = true
    node.data.push(data) // Store the associated data
  }

  searchWithLevenshteinWithData (word, maxDistance) {
    const results = []
    this._searchRecursiveWithData(this.root, '', word, 0, maxDistance, results)
    return results
  }

  _searchRecursiveWithData (node, currentWord, targetWord, currentIndex, maxDistance, results) {
    if (currentIndex > targetWord.length && node.isEndOfWord) {
      results.push({ word: currentWord, data: node.data })
      return
    }
    if (maxDistance < 0) {
      return
    }

    if (node.isEndOfWord && this.levenshteinDistance(currentWord, targetWord) <= maxDistance) {
      results.push({ word: currentWord, data: node.data })
    }

    for (const [char, childNode] of node.children) {
      let newDistance = maxDistance
      if (currentIndex < targetWord.length) {
        if (char === targetWord[currentIndex]) {
          this._searchRecursiveWithData(
            childNode,
            currentWord + char,
            targetWord,
            currentIndex + 1,
            newDistance,
            results
          )
        } else {
          newDistance = maxDistance - 1 //substitution
          this._searchRecursiveWithData(
            childNode,
            currentWord + char,
            targetWord,
            currentIndex + 1,
            newDistance,
            results
          )
          this._searchRecursiveWithData(
            node,
            currentWord,
            targetWord,
            currentIndex + 1,
            newDistance,
            results
          ) //insertion
          this._searchRecursiveWithData(
            childNode,
            currentWord + char,
            targetWord,
            currentIndex,
            newDistance,
            results
          ) // deletion
        }
      } else {
        this._searchRecursiveWithData(childNode, currentWord + char, targetWord, currentIndex, newDistance - 1, results)
      }
    }
  }
}
