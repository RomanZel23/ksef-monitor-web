const { exec } = require('child_process');

async function testConnection() {
    const url = 'https://ksef-test.mf.gov.pl/api/online/Definition/PublicCredentials';
    console.log(`Testing connection (via curl) to: ${url}`);

    const cmd = `curl -v --http1.1 -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" "${url}"`;

    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error.message}`);
            return;
        }
        console.log(`stdout: ${stdout}`);
        console.log(`stderr: ${stderr}`);
    });
}

testConnection();
