const puppeteer = require('puppeteer')
const { isPreviewMode } = require('./cli')
let pageGlobal
let browserGlobal
module.exports = {
  async getPage(url, conf = {}) {
    const browser = await puppeteer.launch(Object.assign({
      defaultViewport: null,
      headless: false,
      // devtools: true
    }, conf))
    const page = await browser.newPage()
    pageGlobal = page
    browserGlobal = browser
    await page.goto(url)
    return page
  },
  /** @param {import('puppeteer').Page} page */
  async screen(page, path) {
    const conf = {
      clip: {
        x: 0,
        y: 0,
        width: 400,
        height: 400,
      },
    }
    if (path && !isPreviewMode) {
      await page.screenshot({
        ...conf,
        path
      })
    }
    return page.screenshot({
      ...conf,
      encoding: 'base64',
      type: 'jpeg',
    })
  },
  async close() {
    await pageGlobal.close().catch(() => { })
    await browserGlobal.close().catch(() => { })
  }
}