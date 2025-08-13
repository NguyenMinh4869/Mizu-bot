const http = require('http');

const port = process.env.PORT || 10000;

const requestListener = (req, res) => {
	if (req.url === '/health') {
		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end('OK');
		return;
	}

	res.writeHead(200, { 'Content-Type': 'text/plain' });
	res.end('Mizu-bot is running');
};

const server = http.createServer(requestListener);

server.listen(port, () => {
	console.log(`HTTP server listening on ${port}`);
});

process.on('SIGTERM', () => {
	server.close(() => {
		process.exit(0);
	});
});


