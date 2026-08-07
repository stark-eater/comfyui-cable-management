import { chromium } from 'playwright'
for (const opts of [{ channel: 'msedge' }, { channel: 'chrome' }, {}]) {
  try {
    const b = await chromium.launch({ ...opts, headless: true })
    console.log('OK', JSON.stringify(opts), await b.version())
    await b.close()
    process.exit(0)
  } catch (e) {
    console.log('fail', JSON.stringify(opts), String(e).split('\n')[0].slice(0, 100))
  }
}
process.exit(1)
