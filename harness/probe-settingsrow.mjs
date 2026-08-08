// One-off: legacy 8187 -- settings row must show the new label and a disabled switch.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.LiteGraph, null, { timeout: 120_000 })
await page.waitForTimeout(2500)

await page.evaluate(() => window.app.extensionManager.command.execute('Comfy.ShowSettingsDialog'))
await page.waitForTimeout(1200)
// search so the row is on screen regardless of category tree state
const search = page.locator('input[placeholder="Search Settings..."]').first()
await search.fill('cable management')
await page.waitForTimeout(800)

const row = await page.evaluate(() => {
  const all = [...document.querySelectorAll('div, label, span')]
  const lab = all.find((el) => el.childElementCount === 0 && /Cable Management node features/.test(el.textContent ?? ''))
  if (!lab) return { found: false }
  const rowEl = lab.closest('.setting-item, [class*="form"], tr, .flex') ?? lab.parentElement
  const sw = rowEl?.parentElement?.querySelector('button[role="switch"]') ?? document.querySelector('button[role="switch"]')
  return {
    found: true,
    label: lab.textContent.trim(),
    switchFound: !!sw,
    disabledAttr: sw?.disabled ?? null,
    dataDisabled: sw?.getAttribute('data-disabled'),
    ariaChecked: sw?.getAttribute('aria-checked'),
  }
})
console.log(JSON.stringify(row, null, 1))
await b.close()
process.exit(row.found && row.switchFound && (row.disabledAttr || row.dataDisabled != null) ? 0 : 1)
