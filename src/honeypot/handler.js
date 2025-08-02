// --- src/honeypot/handler.js ---
import { URL } from 'url';
import fs from 'fs';
import path from 'path';
import querystring from 'querystring';
import geoip from 'geoip-lite';
import he from 'he';
import { log } from '../utils/logger.js';
import { honeypotData, incrementRankCounter, honeypotRankCounter } from './state.js';

// --- Main Handler Function ---
export function handleHoneypotRequest(req, res, clientIp) {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // GET /wp-login.php and similar
    if (req.method === 'GET' && (
        url.pathname === '/wp-admin/setup-config.php' ||
        url.pathname === '/wordpress/wp-admin/setup-config.php' ||
        url.pathname === '/wp-login.php'
    )) {
        serveFakeLoginPage(res, clientIp, url.pathname);
        return true; // Request handled
    }

    // POST /wp-login.php
    if (req.method === 'POST' && url.pathname === '/wp-login.php') {
        handleFakeLoginAttempt(req, res, clientIp);
        return true; // Request handled
    }

    // GET /honeypot-leaderboard
    if (req.method === 'GET' && url.pathname === '/honeypot-leaderboard') {
        serveLeaderboard(res, clientIp);
        return true; // Request handled
    }

    return false; // Not a honeypot request
}

// --- Specific Logic Functions ---
function serveFakeLoginPage(res, clientIp, pathname) {
    log('warn', 'HONEYPOT: Serving fake WP login page', { ip: clientIp, path: pathname });
    const filePath = path.join(process.cwd(), 'wp-login.html');
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            log('error', 'HONEYPOT: Error reading wp-login.html', { error: err.message, path: filePath });
            res.writeHead(500);
            res.end('Error loading honeypot login page.');
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
    });
}

function handleFakeLoginAttempt(req, res, clientIp) {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
        const formData = querystring.parse(body);
        const geo = geoip.lookup(clientIp);
        const username = formData.log || 'N/A';
        const password = formData.pwd || 'N/A';
        const countryCode = geo ? geo.country : 'N/A';

        log('error', 'HONEYPOT: Bot caught!', { ip: clientIp, username, password, country: countryCode });

        if (!honeypotData[clientIp]) {
            honeypotData[clientIp] = {
                rank: honeypotRankCounter,
                attempts: 0,
                topUser: '',
                topPass: '',
                topPassLength: 0,
                country: countryCode,
                flag: getFlagEmoji(countryCode),
                firstSeen: new Date().toISOString(),
                lastSeen: new Date().toISOString()
            };
            incrementRankCounter();
        }

        honeypotData[clientIp].attempts++;
        honeypotData[clientIp].lastSeen = new Date().toISOString();
        if (password.length > honeypotData[clientIp].topPassLength) {
            honeypotData[clientIp].topUser = username;
            honeypotData[clientIp].topPass = password;
            honeypotData[clientIp].topPassLength = password.length;
        }

        res.writeHead(302, { 'Location': '/honeypot-leaderboard' });
        res.end();
    });
}

function serveLeaderboard(res, clientIp) {
    log('info', 'HONEYPOT: Serving leaderboard', { ip: clientIp });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(generateLeaderboardHtml());
}

// --- HTML Generation and Helpers ---
function getFlagEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) return '❓';
    const codePoints = countryCode.toUpperCase().split('').map(char => 0x1F1E6 + (char.charCodeAt(0) - 'A'.charCodeAt(0)));
    return String.fromCodePoint(...codePoints);
}

function generateLeaderboardHtml() {
    const sortedIps = Object.keys(honeypotData).sort((a, b) => honeypotData[b].attempts - honeypotData[a].attempts);

    let tableRows = '';
    if (sortedIps.length === 0) {
        tableRows = '<tr><td colspan="6" style="text-align: center; color: #888;">It\'s quiet... too quiet. No bots caught yet.</td></tr>';
    } else {
        sortedIps.forEach((ip, index) => {
            const data = honeypotData[ip];
            const maskedIp = ip.split('.').slice(0, 2).join('.') + '.***.***';
            tableRows += `
                <tr>
                    <td data-label="Rank"><span>${index + 1}</span></td>
                    <td data-label="IP Address"><span>${maskedIp}</span></td>
                    <td data-label="Attempts"><span>${data.attempts}</span></td>
                    <td data-label="Top Username"><span>${he.encode(String(data.topUser))}</span></td>
                    <td data-label="Top Password" class="pass-cell"><span>${he.encode(String(data.topPass))}</span></td>
                    <td data-label="Country"><span>${data.flag} ${he.encode(String(data.country))}</span></td>
                </tr>
            `;
        });
    }

    // --- FULL HTML STRING ---
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Honeypot - Hall of Shame</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background-color: #121212; color: #e0e0e0; margin: 0; padding: 2em; }
            .container { max-width: 1000px; margin: 0 auto; background-color: #1e1e1e; border-radius: 8px; padding: 2em; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
            h1 { color: #bb86fc; text-align: center; border-bottom: 2px solid #bb86fc; padding-bottom: 0.5em; margin-bottom: 1.5em; }
            table { width: 100%; border-collapse: collapse; margin-top: 2em; }
            th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #333; }
            th { background-color: #333; color: #bb86fc; font-weight: 600; }
            tr:nth-child(even) { background-color: #242424; }
            tr:hover { background-color: #4a4a4a; }
            .pass-cell { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; }
            
            @media screen and (max-width: 768px) {
                body { padding: 1em; }
                .container { padding: 1.5em 1em; }
                table thead { display: none; }
                table, tbody, tr, td { display: block; width: 100%; }
                tr { margin-bottom: 1.5em; border: 1px solid #333; border-radius: 5px; background-color: #242424; overflow: hidden; }
                td { display: flex; align-items: center; padding: 12px 15px; border-bottom: 1px dotted #444; gap: 1em; }
                td:last-child { border-bottom: none; }
                td::before { content: attr(data-label); font-weight: bold; color: #bb86fc; flex-shrink: 0; min-width: 120px; }
                td span { flex-grow: 1; min-width: 0; text-align: left; word-break: break-word; padding-right: 8px; overflow-wrap: break-word; }
                .pass-cell { align-items: flex-start; }
                .pass-cell span { font-family: monospace; color: #ccc; font-size: 0.9em; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>WordPress Sisyphus Crew - Leaderboard of Idiots</h1>
            <table>
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>IP Address</th>
                        <th>Attempts</th>
                        <th>Top Username</th>
                        <th>Top Password</th>
                        <th>Country</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </div>
    </body>
    </html>`;
}