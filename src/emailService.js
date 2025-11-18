const axios = require('axios');
const config = require('./config');

function sendJson(res, statusCode, obj) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
}

async function handleRequestEmail(req, res) {
    try {
        const { token } = req.body || {};

        if (!token) {
            return sendJson(res, 400, { error: 'reCAPTCHA token is required' });
        }

        const response = await axios.post('https://www.google.com/recaptcha/api/siteverify', null, {
            params: {
                secret: config.recaptchaSecretKey,
                response: token,
            },
        });

        const { success } = response.data || {};

        if (success) {
            if (!config.contactEmail) {
                return sendJson(res, 500, { error: 'server_not_configured' });
            }
            return sendJson(res, 200, { email: config.contactEmail });
        }

        return sendJson(res, 400, { error: 'recaptcha_failed' });
    } catch (error) {
        console.error('reCAPTCHA verification error:', error);
        return sendJson(res, 500, { error: 'internal_error' });
    }
}

module.exports = {
    handleRequestEmail,
};
