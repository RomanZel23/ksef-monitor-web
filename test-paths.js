const { exec } = require('child_process');

const urls = [
    'https://api-demo.ksef.mf.gov.pl/online/Session/AuthorisationChallenge',
    'https://api-demo.ksef.mf.gov.pl/v2/online/Session/AuthorisationChallenge',
    'https://api-demo.ksef.mf.gov.pl/v2/session/authorisation-challenge',
    'https://api-demo.ksef.mf.gov.pl/api/online/Session/AuthorisationChallenge'
];

async function checkUrl(url) {
    return new Promise((resolve) => {
        // Use POST with JSON header
        const cmd = `curl -X POST -v -m 5 -H "Content-Type: application/json" -A "Mozilla/5.0" "${url}"`;
        exec(cmd, (error, stdout, stderr) => {
            const statusMatch = stderr.match(/< HTTP\/\d(?:\.\d)?\s+(\d{3})/);
            const status = statusMatch ? statusMatch[1] : 'ERR';
            console.log(`[${status}] ${url}`);
            resolve();
        });
    });
}

(async () => {
    console.log("Testing KSeF URL Paths...");
    for (const url of urls) {
        await checkUrl(url);
    }
})();
