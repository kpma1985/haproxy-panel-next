'use strict';

process
	.on('uncaughtException', console.error)
	.on('unhandledRejection', console.error);

const dotenv = require('dotenv');
dotenv.config({ path: '.env' });

const server = require('express')
	, nextjs = require('next')
	, dev = process.env.NODE_ENV !== 'production'
	, hostname = 'localhost'
	, port = 3000
	, app = nextjs({ dev, hostname, port })
	, handle = app.getRequestHandler()
	, express = require('express')
	, bodyParser = require('body-parser')
	, cookieParser = require('cookie-parser')
	, acme = require('./acme.js')
	, redis = require('./redis.js')
	, db = require('./db.js');

app.prepare()
	.then(async () => {

		await db.connect();
		await acme.init();

		const server = express();
		server.set('query parser', 'simple');
		server.use(bodyParser.json({ extended: false })); // for parsing application/json
		server.use(bodyParser.urlencoded({ extended: false })); // for parsing application/x-www-form-urlencoded
		server.use(cookieParser(process.env.COOKIE_SECRET));
		server.disable('x-powered-by');
		server.set('trust proxy', 1);
		server.use('/.well-known/acme-challenge', express.static('/tmp/.well-known/acme-challenge'))

		const testRouter = require('./router.js');
		testRouter(server, app);

		server.get('*', (req, res) => {
			return handle(req, res);
		});

		server.use((err, req, res, next) => {
			const now = Date.now();
			console.error('An error occurred', now, err);
			return res.send('An error occurred. Please contact support with code: '+now);
		});

		server.listen(3000, (err) => {
			if (err) {
				throw err;
			}
			if (typeof process.send === 'function') {
				console.log('SENT READY SIGNAL TO PM2');
				process.send('ready');
			}
			console.log('> Ready on http://localhost:3000');
		});

		//graceful stop handling
		const gracefulStop = () => {
			console.log('SIGINT SIGNAL RECEIVED');
			db.client.close();
			redis.close();
			process.exit(0);
		};
		process.on('SIGINT', gracefulStop);
		process.on('message', (message) => {
			if (message === 'shutdown') {
				gracefulStop();
			}
		});

	})
	.catch(err => {
		console.error(err.stack);
		process.exit(1);
	});
