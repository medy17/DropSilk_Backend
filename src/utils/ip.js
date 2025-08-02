// --- src/utils/ip.js ---

import os from 'os';
import { log } from './logger.js';

export function getClientIp(req) {
    // Get IP from the X-Forwarded-For header (if behind a proxy) or fall back to direct IP.
    const rawIp = req.headers['x-forwarded-for']?.split(',').shift() || req.socket.remoteAddress;
    return getCleanIPv4(rawIp);
}

export function getCleanIPv4(ip) {
    if (!ip || typeof ip !== 'string') {
        log('warn', 'Invalid IP address received for cleaning', { ip });
        return 'unknown';
    }
    if (ip.startsWith('::ffff:')) {
        return ip.substring(7); // Remove IPv6 prefix for IPv4-mapped addresses
    }
    if (ip === '::1') {
        return '127.0.0.1'; // Loopback for IPv6
    }
    return ip;
}

export function isPrivateIP(ip) {
    if (!ip || typeof ip !== 'string') return false;
    return ip.startsWith('10.') ||
        ip.startsWith('192.168.') ||
        ip.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./);
}

export function isCgnatIP(ip) {
    if (!ip || typeof ip !== 'string') return false;
    return ip.startsWith('100.') && ip.match(/^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./);
}

export function getLocalIpForDisplay() {
    try {
        const nets = os.networkInterfaces();
        for (const name of Object.keys(nets)) {
            for (const net of nets[name]) {
                if (net.family === "IPv4" && !net.internal) {
                    return net.address;
                }
            }
        }
        return "localhost";
    } catch (error) {
        log('error', 'Error getting local IP for display', { error: error.message });
        return "localhost";
    }
}