const axios = require('axios');
const config = require('./config');

async function handleRequestEmail(req, res) {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ error: 'reCAPTCHA token is required' });
    }

    try {
        const response = await axios.post('https://www.google.com/recaptcha/api/siteverify', null, {
            params: {
                secret: config.recaptchaSecretKey,
                response: token
            }
        });

        const { success } = response.data;

        if (success) {
            res.status(200).json({ email: config.contactEmail });
        } else {
            res.status(400).json({ error: 'reCAPTCHA verification failed' });
        }
    } catch (error) {
        console.error('reCAPTCHA verification error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = {
    handleRequestEmail
};
