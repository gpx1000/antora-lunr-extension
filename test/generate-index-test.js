/* eslint-env mocha */
'use strict'

const { buildContentCatalog, configureLogger, expect } = require('./harness')
const lunr = require('lunr')

const generateIndex = require('../lib/generate-index')

describe('generateIndex()', () => {
  let playbook

  beforeEach(() => {
    playbook = {
      site: {
        url: 'https://docs.example.org',
      },
      urls: {
        htmlExtensionStyle: 'indexify',
      },
    }
  })

  it('should expose generateIndex as an exported function of main script', () => {
    expect(require('@antora/lunr-extension').generateIndex).to.equal(
      generateIndex
    )
  })

  it('should expose generateIndex as an exported function via require path', () => {
    expect(require('@antora/lunr-extension/generate-index')).to.equal(
      generateIndex
    )
  })

  it('should generate an empty index when there are no pages', () => {
    // no page, no index!
    const contentCatalog = buildContentCatalog(playbook)
    const index = generateIndex(playbook, contentCatalog)
    expect(index).to.be.empty()
  })

  it('should generate an index', () => {
    playbook.urls.htmlExtensionStyle = 'drop'
    const contentCatalog = buildContentCatalog(playbook, [
      {
        contents: Buffer.from('<article class="doc"><p>foo</p></article>'),
        src: {
          component: 'component-a',
          version: '2.0',
          relative: 'install-foo.adoc',
        },
      },
    ])
    const index = generateIndex(playbook, contentCatalog)
    const installPage = index.store.documents[1]
    expect(installPage.url).to.equal('/component-a/2.0/install-foo')
    expect(installPage.text).to.equal('foo')
    expect(installPage.component).to.equal('component-a')
    expect(installPage.version).to.equal('2.0')
    expect(
      index.index.search('foo'),
      'foo is present in contents'
    ).to.have.lengthOf(1)
    expect(index.index.search('2.0'), '2.0 is not indexed').to.be.empty()
    expect(index.index.search('bar'), 'bar is not present').to.be.empty()
    expect(
      index.index.search('install-foo'),
      'install-foo is present in url'
    ).to.have.lengthOf(1)
    expect(
      index.index.search('component-a'),
      'component-a is present in component'
    ).to.have.lengthOf(1)
    expect(
      index.index.search('*foo*'),
      '*foo* is present in contents'
    ).to.have.lengthOf(1)
    expect(
      index.index.search('foo*'),
      'foo* is present in contents'
    ).to.have.lengthOf(1)
  })

  it('should provide a levenshtein patricia trie for fuzzy search', () => {
    const contentCatalog = buildContentCatalog(playbook, [
      {
        contents: Buffer.from('<article class="doc"><p><h2>foo</h2>bar</p></article>'),
        src: {
          component: 'component-a',
          version: '2.0',
          relative: 'install-foo.adoc',
        },
      },
    ])
    const index = generateIndex(playbook, contentCatalog)
    expect(index.store.trie.searchWithLevenshteinWithData('fao', 2), `this is the results ${index.store.trie.save()}`).to.have.lengthOf(1)
  })

  it('should use provided logger to log info message that search index is being built with languages', () => {
    const contentCatalog = buildContentCatalog(playbook, [
      {
        contents: Buffer.from('<article class="doc"><p>foo</p></article>'),
        src: {
          component: 'component-a',
          version: '2.0',
          relative: 'install-foo.adoc',
        },
      },
    ])
    const messages = []
    const logger = configureLogger({
      level: 'info',
      destination: { write: (message) => messages.push(message) },
    }).get()
    generateIndex(playbook, contentCatalog, { logger })
    expect(messages).to.not.be.empty()
    expect(JSON.parse(messages[0])).to.include({
      level: 'info',
      msg: 'Building search index with the language(s): en',
    })
  })

  it('should use console if logger not provided to log message that search index is being built with languages', () => {
    const contentCatalog = buildContentCatalog(playbook, [
      {
        contents: Buffer.from('<article class="doc"><p>foo</p></article>'),
        src: {
          component: 'component-a',
          version: '2.0',
          relative: 'install-foo.adoc',
        },
      },
    ])
    const messages = []
    const write = process.stdout.write
    const nodeEnv = process.env.NODE_ENV
    try {
      delete process.env.NODE_ENV
      process.stdout.write = (message) => messages.push(message)
      generateIndex(playbook, contentCatalog)
      expect(messages).to.not.be.empty()
      expect(messages[0]).to.equal(
        'Building search index with the language(s): en\n'
      )
    } finally {
      if (nodeEnv) process.env.NODE_ENV = nodeEnv
      process.stdout.write = write
    }
  })

  it('should generate a document for each titles', () => {
    playbook.urls = { htmlExtensionStyle: 'indexify' }
    const contentCatalog = buildContentCatalog(playbook, [
      {
        contents: Buffer.from(`
          <article class="doc">
            <h1>Antora Documentation</h1>
            <p>The Static Site Generator for Tech Writers</p>
            <p>This site hosts the technical documentation for Antora</p>
            <h2 id="manage-docs-as-code">Manage docs as code</h2>
            <p>With Antora, you manage docs as code</p>
            <h3 id="where-to-begin">Where to begin</h3>
            <h4 id="navigation">Navigation</h4>
            <h5 id="link-types-syntax">Link Types & Syntax</h5>
            <h6 id="page-links">Page Links</h6>
          </article>`),
        src: {
          component: 'hello',
          version: '1.0',
        },
      },
    ])
    const index = generateIndex(playbook, contentCatalog)
    const installPage = index.store.documents[1]
    expect(installPage.url).to.equal('/hello/1.0/')
    expect(installPage.text).to.equal(
      'The Static Site Generator for Tech Writers This site hosts the technical documentation for Antora With Antora, you manage docs as code'
    )
    expect(installPage.component).to.equal('hello')
    expect(installPage.version).to.equal('1.0')
    expect(installPage.title).to.equal('Antora Documentation')
    expect(index.index.search('1.0'), 'version is not indexed').to.be.empty()
    expect(index.index.search('bar'), 'bar is not present').to.be.empty()
    expect(
      index.index.search('where to begin'),
      '"Where to begin" is indexed as a title'
    ).to.have.lengthOf(1)
    expect(
      index.index.search('docs as code'),
      '"docs as code" is indexed two times'
    ).to.have.lengthOf(2)
    expect(
      index.index.search('technical'),
      '"technical" is indexed'
    ).to.have.lengthOf(1)
    expect(
      index.index.search('hello'),
      '"hello" is indexed as component'
    ).to.have.lengthOf(1)
  })

  it('should not index navigation titles', () => {
    playbook.urls = { htmlExtensionStyle: 'indexify' }
    const contentCatalog = buildContentCatalog(playbook, [
      {
        contents: Buffer.from(`
<aside class="navigation">
  <nav class="nav-menu">
    <h3 class="title"><a href="./">Asciidoctor</a></h3>
      <ul class="nav-list">
        <li class="nav-item">How Asciidoctor Can Help</li>
        <li class="nav-item">How Asciidoctor Works</li>
      </ul>
    </nav>
</aside>
<article class="doc">
  <h1>Antora Documentation</h1>
  <p>The Static Site Generator for Tech Writers</p>
  <p>This site hosts the technical documentation for Antora</p>
  <h2 id="manage-docs-as-code">Manage docs as code</h2>
  <p>With Antora, you manage docs as code</p>
  <h3 id="where-to-begin">Where to begin</h3>
  <h4 id="navigation">Navigation</h4>
  <h5 id="link-types-syntax">Link Types & Syntax</h5>
  <h6 id="page-links">Page Links</h6>
</article>`),
        src: {
          component: 'hello',
          version: '1.0',
        },
      },
    ])
    const index = generateIndex(playbook, contentCatalog)
    const installPage = index.store.documents[1]
    expect(installPage.url).to.equal('/hello/1.0/')
    expect(installPage.text).to.equal(
      'The Static Site Generator for Tech Writers This site hosts the technical documentation for Antora With Antora, you manage docs as code'
    )
    expect(installPage.component).to.equal('hello')
    expect(installPage.version).to.equal('1.0')
    expect(installPage.title).to.equal('Antora Documentation')
    expect(
      index.index.search('asciidoctor'),
      '"Asciidoctor" is a navigation title and should not be indexed'
    ).to.have.lengthOf(0)
    expect(
      index.index.search('help'),
      '"How Antora Can Help" is a navigation item and should not be indexed'
    ).to.have.lengthOf(0)
  })

  it('should not index pagination', () => {
    playbook.urls = { htmlExtensionStyle: 'indexify' }
    const contentCatalog = buildContentCatalog(playbook, [
      {
        contents: Buffer.from(`
          <article class="doc">
            <h1>Antora Documentation</h1>
            <p>The Static Site Generator for Tech Writers</p>
            <nav class="pagination">
              Pagination
            </nav>
          </article>`),
        src: {
          component: 'hello',
          version: '1.0',
        },
      },
    ])
    const index = generateIndex(playbook, contentCatalog)
    const installPage = index.store.documents[1]
    expect(installPage.url).to.equal('/hello/1.0/')
    expect(installPage.text).to.equal(
      'The Static Site Generator for Tech Writers'
    )
  })

  it('should only index the first document title (heading 1)', () => {
    delete playbook.urls.htmlExtensionStyle
    const contentCatalog = buildContentCatalog(playbook, [
      {
        contents: Buffer.from(`
          <article class="doc">
            <h1 class="page">What’s New in Antora</h1>
            <div id="preamble">
              <div class="sectionbody">
                <div class="paragraph">
                  <p>Learn about what’s new in the 2.0 release series of Antora.</p>
                </div>
              </div>
            </div>
            <h1 id="antora-2-0-0" class="sect0"><a class="anchor" href="#antora-2-0-0"></a>Antora 2.0.0</h1>
            <div class="openblock partintro">
              <div class="content">
                <div class="paragraph">
                  <p><em><strong>Release date:</strong> 2018.12.25 | <strong>Milestone (closed issues):</strong> <a href="https://gitlab.com/antora/antora/issues?milestone_title=v2.0.x&amp;scope=all&amp;state=closed" target="_blank" rel="noopener">v2.0.x</a></em></p>
                </div>
                <div class="paragraph">
                  <p>The Antora 2.0.0 release streamlines the installation process, improves platform and library compatibility, provides a simpler and pluggable authentication mechanism for private repositories, and delivers the latest Asciidoctor capabilities.</p>
                </div>
              </div>
            </div>
          </article>`),
        src: {
          component: 'hello',
          version: '1.0',
          relative: 'whats-new.adoc',
        },
      },
    ])
    const index = generateIndex(playbook, contentCatalog)
    const whatsNewPage = index.store.documents[1]
    expect(whatsNewPage.url).to.equal('/hello/1.0/whats-new.html')
    expect(whatsNewPage.title).to.equal('What’s New in Antora')
  })

  it('should exclude pages with noindex defined as metadata', () => {
    playbook.urls = { htmlExtensionStyle: 'indexify' }
    const contentCatalog = buildContentCatalog(playbook, [
      {
        contents: Buffer.from(`
          <html lang="en">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width,initial-scale=1">
              <title>Antora Documentation :: Antora Docs</title>
              <meta name="keywords" content="Docs as Code, DocOps, content management system, docs writers, publish software documentation, CI and docs, CD and docs">
              <meta name="generator" content="Antora 2.0.0">
              <meta name="robots" content="noindex">
            </head>
            <body class="article">
              <main role="main">
                <article class="doc">
                  <h1 class="page">Antora Documentation</h1>
                  <div class="sect1">
                    <h2 id="manage-docs-as-code"><a class="anchor" href="#manage-docs-as-code"></a>Manage docs as code</h2>
                    <div class="sectionbody">
                      <div class="paragraph">
                        <p>With Antora, you manage <strong>docs as code</strong>.
                        That means your documentation process benefits from the same practices used to produce successful software.</p>
                      </div>
                      <div class="paragraph">
                        <p>Some of these practices include:</p>
                      </div>
                      <div class="ulist">
                        <ul>
                          <li>
                            <p>Storing content in a version control system.</p>
                          </li>
                          <li>
                            <p>Separating content, configuration, and presentation.</p>
                          </li>
                          <li>
                            <p>Leveraging automation for compilation, validation, verification, and publishing.</p>
                          </li>
                          <li>
                            <p>Reusing shared materials (DRY).</p>
                          </li>
                        </ul>
                      </div>
                      <div class="paragraph">
                        <p>Antora helps you incorporate these practices into your documentation workflow.
                        As a result, your documentation is much easier to manage, maintain, and enhance.</p>
                      </div>
                    </div>
                  </div>
                </article>
              </main>
            </body>
          </html>`),
        src: {
          component: 'hello',
          version: '1.0',
        },
      },
      {
        contents: Buffer.from(`
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Antora Documentation :: Antora Docs</title>
  <meta name="keywords" content="Docs as Code, DocOps, content management system, docs writers, publish software documentation, CI and docs, CD and docs">
  <meta name="generator" content="Antora 2.0.0">
  <meta name="robots" content="index">
</head>
<body class="article">
  <main role="main">
    <article class="doc">
      <h1 class="page">How Antora Can Help You and Your Team</h1>
      <div class="sect1">
        <h2 id="agile-and-secure"><a class="anchor" href="#agile-and-secure"></a>Agile and secure</h2>
        <div class="sectionbody">
          <div class="paragraph">
              <p><strong>Automate the assembly of your secure, nimble static site as changes happen instead of wrestling with a CMS giant.</strong></p>
          </div>
          <div class="paragraph">
            <p>Rebuild and deploy your site automatically in a matter of seconds in response to any change.
            Never have to worry about patching security holes in your deployed CMS application since you don’t have one.
            All pages are static—&#8203;in the JAMstack style.
            Need to migrate your site to a different domain?
            Just rebuild the site and relaunch it on the new host.</p>
          </div>
          <div class="paragraph">
            <p><strong>Adapt your site to fit seamlessly with your other web properties.</strong></p>
          </div>
          <div class="paragraph">
            <p>No site is an island.
            Sites must play nice with others to maintain a consistent brand and user experiences.
            Static sites generated by Antora are well-suited for this role.
            With page templates and a little help from an automated process, you can blend your documentation pages into existing sites, giving the impression it’s all part of a single uniform site.</p>
          </div>
        </div>
      </div>
    </article>
  </main>
</body>
</html>`),
        src: {
          component: 'hello',
          version: '1.0',
          relative: 'features.adoc',
        },
      },
    ])
    const index = generateIndex(playbook, contentCatalog)
    expect(Object.keys(index.store.documents)).to.have.lengthOf(1)
    expect(index.store.documents).to.have.property('1')
    const featuresPage = index.store.documents[1]
    expect(featuresPage.url).to.equal('/hello/1.0/features/')
    expect(featuresPage.text).to.equal(
      'Automate the assembly of your secure, nimble static site as changes happen instead of wrestling with a CMS giant. Rebuild and deploy your site automatically in a matter of seconds in response to any change. Never have to worry about patching security holes in your deployed CMS application since you don’t have one. All pages are static—​in the JAMstack style. Need to migrate your site to a different domain? Just rebuild the site and relaunch it on the new host. Adapt your site to fit seamlessly with your other web properties. No site is an island. Sites must play nice with others to maintain a consistent brand and user experiences. Static sites generated by Antora are well-suited for this role. With page templates and a little help from an automated process, you can blend your documentation pages into existing sites, giving the impression it’s all part of a single uniform site.'
    )
  })

  it('should exclude pages with noindex defined as attribute', () => {
    playbook.urls = { htmlExtensionStyle: 'indexify' }
    const contentCatalog = buildContentCatalog(playbook, [
      {
        contents: Buffer.from(`
<html lang="en">
  <body class="article">
    <main role="main">
      <article class="doc">
        <h1 class="page">Antora Documentation</h1>
        <div class="sect1">
          <h2 id="manage-docs-as-code"><a class="anchor" href="#manage-docs-as-code"></a>Manage docs as code</h2>
          <div class="sectionbody">
            <div class="paragraph">
              <p>With Antora, you manage <strong>docs as code</strong>.
              That means your documentation process benefits from the same practices used to produce successful software.</p>
            </div>
          </div>
        </div>
      </article>
    </main>
  </body>
</html>`),
        src: {
          component: 'hello',
          version: '1.0',
        },
        asciidoc: {
          attributes: {
            noindex: '',
          },
        },
      },
      {
        contents: Buffer.from(`
<html lang="en">
<body class="article">
  <main role="main">
    <article class="doc">
      <h1 class="page">How Antora Can Help You and Your Team</h1>
      <div class="sect1">
        <h2 id="agile-and-secure"><a class="anchor" href="#agile-and-secure"></a>Agile and secure</h2>
        <div class="sectionbody">
          <div class="paragraph">
              <p><strong>Automate the assembly of your secure, nimble static site as changes happen instead of wrestling with a CMS giant.</strong></p>
          </div>
        </div>
      </div>
    </article>
  </main>
</body>
</html>`),
        src: {
          component: 'hello',
          version: '1.0',
          relative: 'features.adoc',
        },
      },
    ])
    const index = generateIndex(playbook, contentCatalog)
    expect(Object.keys(index.store.documents)).to.have.lengthOf(1)
    expect(index.store.documents).to.have.property('1')
    const featuresPage = index.store.documents[1]
    expect(featuresPage.url).to.equal('/hello/1.0/features/')
    expect(featuresPage.text).to.equal(
      'Automate the assembly of your secure, nimble static site as changes happen instead of wrestling with a CMS giant.'
    )
  })

  it('should not parse pages with noindex defined as attribute', () => {
    playbook.urls = { htmlExtensionStyle: 'indexify' }
    const contentCatalog = buildContentCatalog(playbook, [
      {
        contents: Buffer.from(`
<html lang="en">
  <body class="article">
  </body>
</html>`),
        src: {
          component: 'hello',
          version: '1.0',
        },
        asciidoc: {
          attributes: {
            noindex: '',
          },
        },
      },
      {
        contents: Buffer.from(`
<html lang="en">
  <body class="article">
  </body>
</html>`),
        src: {
          component: 'hello',
          version: '1.0',
          relative: 'features.adoc',
        },
      },
    ])
    Object.defineProperty(
      contentCatalog.getById({
        family: 'page',
        component: 'hello',
        version: '1.0',
        module: 'ROOT',
        relative: 'index.adoc',
      }),
      'contents',
      {
        get: function () {
          expect.fail(
            'should not request the contents on page that have noindex!'
          )
        },
      }
    )
    const index = generateIndex(playbook, contentCatalog)
    expect(Object.keys(index.store.documents)).to.have.lengthOf(1)
    expect(index.store.documents).to.have.property('1')
    expect(index.store.documents[1].url).to.equal('/hello/1.0/features/')
  })

  it('should not parse or index pages not in latest version when index_latest_only option is set', () => {
    playbook.urls = { htmlExtensionStyle: 'indexify' }
    const contentCatalog = buildContentCatalog(playbook, [
      {
        contents: Buffer.from(`
<html lang="en">
  <body class="article">
  </body>
</html>`),
        src: {
          component: 'hello',
          version: '1.0',
        },
      },
      {
        contents: Buffer.from(`
<html lang="en">
  <body class="article">
  </body>
</html>`),
        src: {
          component: 'hello',
          version: '2.0',
        },
      },
    ])
    Object.defineProperty(
      contentCatalog.getById({
        family: 'page',
        component: 'hello',
        version: '1.0',
        module: 'ROOT',
        relative: 'index.adoc',
      }),
      'contents',
      {
        get: function () {
          expect.fail(
            'should not request the contents on page that is not in latest version!'
          )
        },
      }
    )
    const index = generateIndex(playbook, contentCatalog, {
      indexLatestOnly: true,
    })
    expect(Object.keys(index.store.documents)).to.have.lengthOf(1)
    expect(index.store.documents).to.have.property('1')
    expect(index.store.documents[1].url).to.equal('/hello/2.0/')
  })

  it('should only index the latest version when there are multiple versions and index_latest_only option is set', () => {
    const contentCatalog = buildContentCatalog(playbook, [
      {
        contents: Buffer.from(`
<html lang="en">
  <body class="article">
    <main role="main">
      <article class="doc">
        <h1 class="page">Antora Documentation</h1>
        <div class="sect1">
          <h2 id="manage-docs-as-code"><a class="anchor" href="#manage-docs-as-code"></a>Manage docs as code</h2>
          <div class="sectionbody">
            <div class="paragraph">
              <p>With Antora, you manage <strong>docs as code</strong>.
              That means your documentation process benefits from the same practices used to produce successful software.</p>
              <p>In the next version which is not this one, we expect to find Spinnacles</p>
            </div>
          </div>
        </div>
      </article>
    </main>
  </body>
</html>`),
        src: {
          component: 'hello',
          version: '1.0',
          relative: 'features.adoc',
        },
      },
      {
        contents: Buffer.from(`
<html lang="en">
<body class="article">
  <main role="main">
    <article class="doc">
      <h1 class="page">How Antora Can Help You and Your Team</h1>
      <div class="sect1">
        <h2 id="agile-and-secure"><a class="anchor" href="#agile-and-secure"></a>Agile and secure</h2>
        <div class="sectionbody">
          <div class="paragraph">
              <p><strong>Automate the assembly of your secure, nimble static site as changes happen instead of wrestling with a CMS giant.</strong></p>
              <p>In the latest version we benefit from having Spinnacles.</p>
          </div>
        </div>
      </div>
    </article>
  </main>
</body>
</html>`),
        src: {
          component: 'hello',
          version: '1.5',
          relative: 'features.adoc',
        },
      },
    ])
    const config = { indexLatestOnly: true }
    const index = generateIndex(playbook, contentCatalog, config)
    expect(index.index.search('spinnacle').length).to.equal(1)
  })

  it('should index section titles', () => {
    playbook.urls = { htmlExtensionStyle: 'indexify' }
    const contentCatalog = buildContentCatalog(playbook, [
      {
        contents: Buffer.from(`
          <html lang="en">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width,initial-scale=1">
              <title>Antora Documentation :: Antora Docs</title>
              <meta name="keywords" content="Docs as Code, DocOps, content management system, docs writers, publish software documentation, CI and docs, CD and docs">
              <meta name="generator" content="Antora 2.0.0">
            </head>
            <body class="article">
              <main role="main">
                <article class="doc">
                  <h1 class="page">Antora Documentation</h1>
                  <div class="sect1">
                    <h2 id="manage-docs-as-code"><a class="anchor" href="#manage-docs-as-code"></a>Manage docs as code</h2>
                    <div class="sectionbody">
                      <div class="paragraph">
                        <p>With Antora, you manage <strong>docs as code</strong>.
                        That means your documentation process benefits from the same practices used to produce successful software.</p>
                      </div>
                      <div class="paragraph">
                        <p>Some of these practices include:</p>
                      </div>
                      <div class="ulist">
                        <ul>
                          <li>
                            <p>Storing content in a version control system.</p>
                          </li>
                          <li>
                            <p>Separating content, configuration, and presentation.</p>
                          </li>
                          <li>
                            <p>Leveraging automation for compilation, validation, verification, and publishing.</p>
                          </li>
                          <li>
                            <p>Reusing shared materials (DRY).</p>
                          </li>
                        </ul>
                      </div>
                      <div class="paragraph">
                        <p>Antora helps you incorporate these practices into your documentation workflow.
                        As a result, your documentation is much easier to manage, maintain, and enhance.</p>
                      </div>
                    </div>
                    <h2 id="where-to-begin"><a class="anchor" href="#where-to-begin"></a>Where to begin</h2>
                    <div class="sectionbody">
                    </div>
                  </div>
                </article>
              </main>
            </body>
          </html>`),
        src: {
          component: 'hello',
          version: '1.0',
        },
      },
    ])
    const index = generateIndex(playbook, contentCatalog)
    const searchResultItems = index.index.search('begin')
    expect(
      searchResultItems,
      'Where to begin title must be found'
    ).to.have.lengthOf(1)
    expect(searchResultItems[0].ref).to.equal('1-2')
    expect(index.store.documents['1'].url).to.equal('/hello/1.0/')
    const sectionTitles = index.store.documents['1'].titles
    expect(sectionTitles).to.have.deep.members([
      {
        text: 'Manage docs as code',
        hash: 'manage-docs-as-code',
        id: 1,
      },
      {
        text: 'Where to begin',
        hash: 'where-to-begin',
        id: 2,
      },
    ])
    expect(sectionTitles.find((title) => title.id === 2).hash).to.equal(
      'where-to-begin'
    )
  })

  it('should index keywords', () => {
    playbook.urls = { htmlExtensionStyle: 'indexify' }
    const contentCatalog = buildContentCatalog(playbook, [
      {
        contents: Buffer.from(`
          <html lang="en">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width,initial-scale=1">
              <title>Antora Documentation :: Antora Docs</title>
              <meta name="generator" content="Antora 2.0.0">
            </head>
            <body class="article">
              <main role="main">
                <article class="doc">
                  <h1 class="page">Antora Documentation</h1>
                </article>
              </main>
            </body>
          </html>`),
        src: {
          component: 'hello',
          version: '1.0',
        },
        asciidoc: {
          attributes: {
            keywords: 'keyword1, lorem ipsum, keyword2',
          },
        },
      },
    ])
    const index = generateIndex(playbook, contentCatalog)
    const searchResultItems1 = index.index.search('keyword2')
    expect(searchResultItems1, 'keyword must be found').to.have.lengthOf(1)

    const searchResultItems2 = index.index.search('keyword:keyword1')
    expect(
      searchResultItems2,
      'keyword must be found found in field keyword'
    ).to.have.lengthOf(1)
  })

  describe('Paths', () => {
    it('should use relative links when site URL is not defined', () => {
      delete playbook.site.url
      playbook.urls.htmlExtensionStyle = 'drop'
      const contentCatalog = buildContentCatalog(playbook, [
        {
          contents: Buffer.from('foo'),
          src: {
            component: 'component-a',
            version: '2.0',
            relative: 'install-foo.adoc',
          },
        },
      ])
      const index = generateIndex(playbook, contentCatalog)
      expect(index.store.documents[1].url).to.equal(
        '/component-a/2.0/install-foo'
      )
    })

    it('should use relative links when site URL is a URL without a subpath', () => {
      const contentCatalog = buildContentCatalog(playbook, [
        {
          contents: Buffer.from('foo'),
          src: {
            component: 'component-a',
            version: '2.0',
            relative: 'install-foo.adoc',
          },
        },
      ])
      const index = generateIndex(playbook, contentCatalog)
      expect(index.store.documents[1].url).to.equal(
        '/component-a/2.0/install-foo/'
      )
    })

    it('should use relative links when site URL is a URL with a subpath', () => {
      playbook.site.url += '/docs'
      const contentCatalog = buildContentCatalog(playbook, [
        {
          contents: Buffer.from('foo'),
          src: {
            component: 'component-a',
            version: '2.0',
            relative: 'install-foo.adoc',
          },
        },
      ])
      const index = generateIndex(playbook, contentCatalog)
      expect(index.store.documents[1].url).to.equal(
        '/component-a/2.0/install-foo/'
      )
    })

    it('should use relative links when site URL is a root-relative path', () => {
      playbook.site.url = '/docs'
      playbook.urls.htmlExtensionStyle = 'drop'
      const contentCatalog = buildContentCatalog(playbook, [
        {
          contents: Buffer.from('foo'),
          src: {
            component: 'component-a',
            version: '2.0',
            relative: 'install-foo.adoc',
          },
        },
      ])
      const index = generateIndex(playbook, contentCatalog)
      expect(index.store.documents[1].url).to.equal(
        '/component-a/2.0/install-foo'
      )
    })

    it('should use relative links when site URL is a file URI', () => {
      playbook.site.url = 'file:///path/to/docs'
      playbook.urls.htmlExtensionStyle = 'drop'
      const contentCatalog = buildContentCatalog(playbook, [
        {
          contents: Buffer.from('foo'),
          src: {
            component: 'component-a',
            version: '2.0',
            relative: 'install-foo.adoc',
          },
        },
      ])
      const index = generateIndex(playbook, contentCatalog)
      expect(index.store.documents[1].url).to.equal(
        '/component-a/2.0/install-foo'
      )
    })
  })

  describe('Languages', () => {
    const frenchArticleWithGermanQuoteContent = `
      <article class="doc">
        <h1 class="page">Quoi de neuf dans Antora ?</h1>
        <div id="preamble">
          <div class="sectionbody">
            <div class="paragraph">
              <p>Des nouveautés à foison !</p>
            </div>
          </div>
        </div>
        <h1 id="antora-2-0-0" class="sect0"><a class="anchor" href="#antora-2-0-0"></a>Antora 2.0.0</h1>
        <div class="openblock partintro">
          <div class="content">
            <div class="paragraph">
              <p>Il est maintenant possible de configurer la position des ancres de sections.</p>
              <p>Auparavant, des anomalies empêchaient d'utiliser la macro <code>xref</code>.</p>
              <p>L'installation d'Antora est désormais plus simple.</p>
              <p>Comme on dit en Allemand :</p>
              <blockquote>Ich heiße Guillaume und ich mage Gemüse</blockquote>
            </div>
          </div>
        </div>
      </article>`

    it('should apply the French stemmer and stopword when languages option is "fr"', () => {
      const contentCatalog = buildContentCatalog(playbook, [
        {
          contents: Buffer.from(frenchArticleWithGermanQuoteContent),
          src: {
            component: 'hello',
            version: '1.0',
            relative: 'whats-new.adoc',
          },
        },
      ])
      const config = { languages: ['fr'] }
      const index = generateIndex(playbook, contentCatalog, config)

      const idx = lunr.Index.load(index.index.toJSON())

      // REMIND: arguably, "empeche" should also returns a result
      // but Lunr languages does not currently replace the accented letter "ê" by "e".
      // https://github.com/MihaiValentin/lunr-languages/issues/68
      // french
      expect(
        idx.search('empêche').length,
        '"empêche" should match because the verb "empêcher" is present'
      ).to.equal(1)
      expect(
        idx.search('nouveaute').length,
        '"nouveaute" should match because the word `nouveautés` is present'
      ).to.equal(1)
      // make sure that missing words are not found
      expect(
        idx.search('feature').length,
        '"feature" should not match because the word is absent'
      ).to.equal(0)
      expect(
        idx.search('fonctionnalité').length,
        '"fonctionnalité" should not match because the word is absent'
      ).to.equal(0)
      // german (not enabled)
      expect(
        idx.search('heiße').length,
        '"heiße" should match because the word `heiße` is present'
      ).to.equal(1)
      expect(
        idx.search('heisse').length,
        '"heisse" should not match because the word `heisse` is absent and the German stemmer is not enabled'
      ).to.equal(0)
      expect(
        idx.search('gemuse').length,
        '"gemuse" should not match because the word `gemuse` is absent and the German stemmer is not enabled'
      ).to.equal(0)
    })

    it('should apply multiple stemmers and stopwords when languages option is "fr,de"', () => {
      const contentCatalog = buildContentCatalog(playbook, [
        {
          contents: Buffer.from(frenchArticleWithGermanQuoteContent),
          src: {
            component: 'hello',
            version: '1.0',
            relative: 'whats-new.adoc',
          },
        },
      ])
      const config = { languages: ['fr', 'de'] }
      const index = generateIndex(playbook, contentCatalog, config)

      const idx = lunr.Index.load(index.index.toJSON())
      // french
      expect(
        idx.search('empêche').length,
        '"empêche" should match because the verb "empêcher" is present'
      ).to.equal(1)
      expect(
        idx.search('nouveaute').length,
        '"nouveaute" should match because the word `nouveautés` is present'
      ).to.equal(1)
      // make sure that missing words are not found
      expect(
        idx.search('feature').length,
        '"feature" should not match because the word is absent'
      ).to.equal(0)
      expect(
        idx.search('fonctionnalité').length,
        '"fonctionnalité" should not match because the word is absent'
      ).to.equal(0)
      // german
      expect(
        idx.search('heiße').length,
        '"heiße" should match because the word `heiße` is present'
      ).to.equal(1)
      expect(
        idx.search('heisse').length,
        '"heisse" should match because the word `heiße` is present and the German stemmer is enabled'
      ).to.equal(1)
      expect(
        idx.search('gemuse').length,
        '"gemuse" should match because the word `Gemüse` is present and the German stemmer is enabled'
      ).to.equal(1)
    })

    it('should apply the default (English) stemmer and stopword when languages option is empty (en)', () => {
      const contentCatalog = buildContentCatalog(playbook, [
        {
          contents: Buffer.from(frenchArticleWithGermanQuoteContent),
          src: {
            component: 'hello',
            version: '1.0',
            relative: 'whats-new.adoc',
          },
        },
      ])
      const index = generateIndex(playbook, contentCatalog)

      const idx = lunr.Index.load(index.index.toJSON())
      expect(
        idx.search('empeche').length,
        '"empeche" should not match any document because "empêchaient" should be indexed as "empêchaient"'
      ).to.equal(0)
      expect(
        idx.search('nouveaute').length,
        '"nouveaute" should not match any document because "nouveautés" should be indexed as "nouveautés"'
      ).to.equal(0)
      expect(idx.search('empêchaient').length).to.equal(1)
      expect(idx.search('nouveautés').length).to.equal(1)
    })
  })
})
