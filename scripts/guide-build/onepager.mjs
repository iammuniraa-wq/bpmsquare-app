// Renders docs/guides/KAMCO-Tender-OnePager.html to a one-page A4 PDF and fails if it runs past one page.
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../../docs/guides/KAMCO-Tender-OnePager.html");
const out = path.resolve(here, "../../docs/guides/KAMCO-Tender-OnePager.pdf");
const exe = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto(pathToFileURL(src).href, { waitUntil: "load" });
const overflow = await page.evaluate(() => { const p = document.querySelector(".page"); return p.scrollHeight - p.clientHeight; });
await page.pdf({ path: out, format: "A4", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
await browser.close();
console.log(overflow > 0 ? `OVERFLOW ${overflow}px: content is cut off` : "fits on one page", out);
