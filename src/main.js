import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

await Actor.init();

const input = await Actor.getInput() || {};
const { searchQueries = [], maxItems = 50, proxyConfig } = input;

const proxyConfiguration = await Actor.createProxyConfiguration(proxyConfig);

let itemCount = 0;

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxConcurrency: 5,
    requestHandlerTimeoutSecs: 120,
    headless: true,
    requestHandler: async ({ request, page, enqueueLinks, log }) => {
        log.info(`Processing ${request.url}...`);

        if (request.label === 'SEARCH_PAGE' || !request.label) {
            // Find and enqueue site links
            await page.waitForSelector('a[href^="/sites/"]', { timeout: 10000 }).catch(() => log.warning('No products found on search page'));
            
            const links = await enqueueLinks({
                selector: 'a[href^="/sites/"]',
                label: 'DETAIL_PAGE',
                strategy: 'all'
            });
            log.info(`Enqueued ${links.processedRequests.length} sites from search page`);
        } else if (request.label === 'DETAIL_PAGE') {
            if (itemCount >= maxItems) return;
            
            await page.waitForLoadState('networkidle').catch(() => {});
            
            const data = await page.evaluate(() => {
                const titleEl = document.querySelector('h1, .box-site-head h2');
                const title = titleEl ? titleEl.innerText.trim() : null;
                
                let score = null;
                const scoreEl = document.querySelector('.circle-score, .note');
                if (scoreEl) {
                    score = parseFloat(scoreEl.innerText.trim());
                }

                let developer = null;
                const devEl = document.querySelector('.by strong, .creator-name');
                if (devEl) {
                    developer = devEl.innerText.trim();
                }
                
                let externalUrl = null;
                const extLink = document.querySelector('a.js-visit-item');
                if (extLink) {
                    externalUrl = extLink.href;
                }

                const tags = Array.from(document.querySelectorAll('.box-tags a, .list-tags li'))
                    .map(el => el.innerText.trim())
                    .filter(t => t.length > 0 && t.length < 30);

                return {
                    url: window.location.href,
                    title,
                    score,
                    developer,
                    externalUrl,
                    tags: [...new Set(tags)]
                };
            });
            
            if (data.title) {
                await Actor.pushData(data);
                itemCount++;
                log.info(`Extracted data for: ${data.title}`);
            }
        }
    },
    failedRequestHandler: ({ request, log }) => {
        log.error(`Request ${request.url} failed too many times.`);
    },
});

const initialRequests = [];

if (searchQueries && searchQueries.length > 0) {
    for (const query of searchQueries) {
        initialRequests.push({
            url: `https://www.awwwards.com/inspiration/search?text=${encodeURIComponent(query)}`,
            label: 'SEARCH_PAGE'
        });
    }
} else {
    // Default fallback
    initialRequests.push({
        url: 'https://www.awwwards.com/websites/',
        label: 'SEARCH_PAGE'
    });
}

await crawler.run(initialRequests);
await Actor.exit();
