const { setupMonocle, setScopes, setScopesBind, startTrace } = require("../../dist")
setupMonocle(
    "expressjs.app"
)

const express = require('express');
const app = express();
const port = 3000;

// Middleware to log all request headers
app.use((req, res, next) => {
    //   console.log('Request Headers:', req.headers);
    next();
});

// Basic route with header extraction
app.get('/', (req, res) => {
    startTrace(() => {
        const userAgent = req.header('User-Agent');
        res.send(`Hello World! Your browser is: ${userAgent}`);
    })
});

// Start the server
app.listen(port, () => {
    console.log(`Express server running at http://localhost:${port}`);
});
