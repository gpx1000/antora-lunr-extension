class TrieNode {
  constructor () {
    this.children = new Map()
    this.isEndOfWord = false
    this.data = [] // Store associated data (e.g., document IDs, URLs)
  }
}

class LevenshteinTrie {
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
    this.root = JSON.parse(jsonString, (key, value) => {
      if (Array.isArray(value)) {
        return new Map(value) // Convert array of entries back to Map
      }
      return value
    })
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

module.exports = LevenshteinTrie
