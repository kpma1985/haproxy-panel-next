'use strict';

process
        .on('uncaughtException', console.error)
        .on('unhandledRejection', console.error);

const dotenv = require('dotenv');
dotenv.config({ path: '.env' });

const redis = require('../redis.js')
	, redlock = require('../redlock.js')
	, Queue = require('bull')
	, haproxyStatsQueue = new Queue('stats', { redis: {
		host: process.env.REDIS_HOST || '127.0.0.1',
		port: process.env.REDIS_PORT || 6379,
		password: process.env.REDIS_PASS || '',
		db: 1,
	}});

if (!process.env.INFLUX_HOST) {
	return console.warn('INFLUX_HOST not set, statistics will not be recorded');
}

const { InfluxDB, Point } = require('@influxdata/influxdb-client')
	, OpenAPIClientAxios = require('openapi-client-axios').default
	, definition = require('../specification_openapiv3.js')
	, agent = require('../agent.js')
	, writeApi = new InfluxDB({ url: process.env.INFLUX_HOST, token: (process.env.INFLUX_TOKEN || null) }).getWriteApi('proxmox', 'proxmoxdb')
	, clusterUrls = process.env.DEFAULT_CLUSTER.split(',').map(u => new URL(u))
	, base64Auth = Buffer.from(`${clusterUrls[0].username}:${clusterUrls[0].password}`).toString("base64");

async function fetchStats(host, parameters) {
	const singleApi = new OpenAPIClientAxios({ definition, axiosConfigDefaults: { httpsAgent: agent, headers: { 'authorization': `Basic ${base64Auth}` } } });
	const singleApiInstance = singleApi.initSync();
	const clusterUrl = new URL(host);
	singleApiInstance.defaults.baseURL = `${clusterUrl.origin}/v2`;
	const statsRes = await singleApiInstance['getStats'](parameters, null, { baseUrl: `${clusterUrl.origin}/v2` });
	return statsRes && statsRes.data && statsRes.data;
};

async function getFormattedStats(host) {
	const [serverStats, frontendStats] = await Promise.all([
		fetchStats(host, { type: 'server', parent: 'servers' }),
		fetchStats(host, { type: 'frontend', name: 'www-http-https' })
	]);

	frontendStats[0].stats = frontendStats[0].stats
		.filter(t => t.name === 'www-http-https')
		.map(t => ({
			'name': t.name,
			'stats': {
				'Bytes in': t.stats.bin,
				'Bytes out': t.stats.bout,
				'Conn rate': t.stats.conn_rate,
				'Cr (max)': t.stats.conn_rate_max,
				'Request rate': t.stats.req_rate,
				'Rr (max)': t.stats.req_rate_max,
				'1xx': t.stats.hrsp_1xx,
				'2xx': t.stats.hrsp_2xx,
				'3xx': t.stats.hrsp_3xx,
				'4xx': t.stats.hrsp_4xx,
				'5xx': t.stats.hrsp_5xx,
				'Total': t.stats.req_tot,
			}
		}));

	serverStats.forEach(server => {
		 server.stats = server.stats
			.filter(t => t.backend_name === 'servers')
			.map(t => ({
				'name': t.name,
				'backend_name': t.backend_name,
				'stats': {
					'Address': t.stats.addr,
					'Bytes in': t.stats.bin,
					'Bytes out': t.stats.bout,
					'Sess rate': t.stats.rate,
					'Sr (max)': t.stats.rate_max,
					'Queue': t.stats.qcur,
					'Q (max)': t.stats.qmax,
					'Q (time)': t.stats.qtime,
					'1xx': t.stats.hrsp_1xx,
					'2xx': t.stats.hrsp_2xx,
					'3xx': t.stats.hrsp_3xx,
					'4xx': t.stats.hrsp_4xx,
					'5xx': t.stats.hrsp_5xx,
					'Total': t.stats.req_tot,
				}
			}));
	});

	return {
		frontendStats,
		serverStats,
	};
};

async function processHost(host) {
	try {
		const hostname = new URL(host).hostname;
		const { frontendStats, serverStats } = await getFormattedStats(host);
		let points = [];
		const now = new Date();
		frontendStats.forEach((s, i) => {
			const statPoints = Object.entries(s.stats[0].stats)
				.map(e => {
					return new Point(e[0])
						.tag('type', 'frontend')
						.tag('hostname', hostname)
						.floatField('value', e[1])
						.timestamp(now);
				});
			points = points.concat(statPoints);
		});
		serverStats.forEach(server => {
			 server.stats.forEach(ss => {
				const statPoints = Object.entries(ss.stats)
					.map(e => {
						return new Point(e[0])
							.tag('type', 'backend')
							.tag('hostname', hostname)
							.tag('server_name', ss.name)
							.tag('server_address', ss.stats["Address"])
							.floatField('value', e[1])
							.timestamp(now);
					});
				points = points.concat(statPoints);
			 });
		});
		await writeApi.writePoints(points);
		await writeApi.flush()
		console.log('Flushed', points.length, 'points to influx');
	} catch (e) {
		if (e && e.cause && e.cause.code && e.cause.code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
			console.error('Error writing stats', new URL(host).hostname, e.cause.code);
		} else {
			console.error('Error writing stats:', e);
		}
	}
};

async function handleJob(job, done) {
	const { hosts } = job.data;
	hosts.forEach(processHost);
	done();
}

haproxyStatsQueue.process(handleJob);

