const bcrypt = require('bcrypt');
const db = require('../db.js');
const { extractMap, dynamicResponse } = require('../util.js');
const { Resolver } = require('node:dns').promises;
const resolver = new Resolver();
resolver.setServers(process.env.NAMESERVERS.split(','));

/**
 * account page data shared between html/json routes
 */
exports.accountData = async (req, res, _next) => {
	let maps = []
		, globalAcl
		, txtRecords = [];
	if (res.locals.user.clusters.length > 0) {
		maps = res.locals.dataPlane
			.getAllRuntimeMapFiles()
			.then(res => res.data)
			.then(data => data.map(extractMap))
			.then(maps => maps.filter(n => n))
			.then(maps => maps.sort((a, b) => a.fname.localeCompare(b.fname)));
		globalAcl = res.locals.dataPlane
			.getOneRuntimeMap('ddos_global')
			.then(res => res.data.description.split('').reverse()[0]);
		txtRecords = resolver.resolve(process.env.NAMESERVER_TXT_DOMAIN, 'TXT');
	}
	([maps, globalAcl, txtRecords] = await Promise.all([maps, globalAcl, txtRecords]));
	return {
		csrf: req.csrfToken(),
		maps,
		globalAcl: globalAcl === '1',
		txtRecords,
	};
};

/**
 * GET /account
 * account page html
 */
exports.accountPage = async (app, req, res, next) => {
	const data = await exports.accountData(req, res, next);
	return app.render(req, res, '/account', { ...data, user: res.locals.user });
}

/**
 * GET /onboarding
 * account page html
 */
exports.onboardingPage = async (app, req, res, next) => {
	const data = await exports.accountData(req, res, next);
	return app.render(req, res, '/onboarding', { ...data, user: res.locals.user });
}

/**
 * GET /account.json
 * account page json data
 */
exports.accountJson = async (req, res, next) => {
	const data = await exports.accountData(req, res, next);
	return res.json({ ...data, user: res.locals.user });
}


/**
 * GET /stats
 * stats page html
 */
exports.statsPage = async (app, req, res, next) => {
	const data = await exports.statsData(req, res, next);
	return app.render(req, res, '/stats', { ...data, user: res.locals.user });
}

/**
 * GET /stats.json
 * stats json
 */
exports.statsJson = async (req, res, next) => {
	const data = await exports.statsData(req, res, next);
	return res.json({ ...data, user: res.locals.user });
}

/**
 * POST /forms/global/toggle
 * toggle global ACL
 */
exports.globalToggle = async (req, res, next) => {
	if (res.locals.user.username !== "admin") {
		return dynamicResponse(req, res, 403, { error: 'Global ACL can only be toggled by an administrator' });
	}
	try {
		const globalAcl = await res.locals.dataPlane
			.getOneRuntimeMap('ddos_global')
			.then(res => res.data.description.split('').reverse()[0])
		if (globalAcl === '1') {
			await res.locals
				.dataPlaneAll('deleteRuntimeMapEntry', {
					map: 'ddos_global',
					id: 'true'
				});
		} else {
			await res.locals
				.dataPlaneAll('addPayloadRuntimeMap', {
					name: 'ddos_global'
				}, [{
					key: 'true',
					value: 'true'
				}]);
		}
	} catch (e) {
		return next(e);
	}
	return dynamicResponse(req, res, 302, { redirect: '/account' });
};

/**
 * POST /forms/login
 * login
 */
exports.login = async (req, res) => {
	const username = req.body.username.toLowerCase();
	const password = req.body.password;
	const account = await db.db.collection('accounts').findOne({ _id: username });
	if (!account) {
		return dynamicResponse(req, res, 403, { error: 'Incorrect username or password' });
	}
	const passwordMatch = await bcrypt.compare(password, account.passwordHash);
	if (passwordMatch === true) {
		req.session.user = account._id;
		return dynamicResponse(req, res, 302, { redirect: '/account' });
	}
	return dynamicResponse(req, res, 403, { error: 'Incorrect username or password' });
};

/**
 * POST /forms/register
 * regiser
 */
exports.register = async (req, res) => {

	if (!res.locals.user || res.locals.user.username !== "admin") {
		return dynamicResponse(req, res, 400, { error: 'Registration is currently disabled, please try again later.' });
	}

	const username = req.body.username.toLowerCase();
	const password = req.body.password;
	const rPassword = req.body.repeat_password;

	if (!username || typeof username !== "string" || username.length === 0
		|| !password || typeof password !== "string" || password.length === 0
		|| !rPassword || typeof rPassword !== "string" || rPassword.length === 0) {
		//todo: length limits, make jschan input validator LGPL lib and use here
		return dynamicResponse(req, res, 400, { error: 'Invalid inputs' });
	}

	if (password !== rPassword) {
		return dynamicResponse(req, res, 400, { error: 'Passwords did not match' });
	}

	const existingAccount = await db.db.collection('accounts').findOne({ _id: username });
	if (existingAccount) {
		return dynamicResponse(req, res, 409, { error: 'Account already exists with this username' });
	}

	const passwordHash = await bcrypt.hash(req.body.password, 12);

	await db.db.collection('accounts')
		.insertOne({
			_id: username,
			displayName: req.body.username,
			passwordHash: passwordHash,
			domains: [],
			clusters: process.env.DEFAULT_CLUSTER ? [process.env.DEFAULT_CLUSTER] : [],
			activeCluster: 0,
			onboarding: false,
		});

	return dynamicResponse(req, res, 302, { redirect: '/login' });

};

/**
 * POST /forms/logout
 * logout
 */
exports.logout = (req, res) => {
	req.session.destroy();
	return dynamicResponse(req, res, 302, { redirect: '/login' });
};

/**
 * POST /forms/onboarding
 * finish/skip onboarding
 */
exports.finishOnboarding = async (req, res) => {
	if (!res.locals.user) {
		return dynamicResponse(req, res, 400, { error: 'Bad request' });
	}
	await db.db.collection('accounts')
		.updateOne({
			_id: res.locals.user.username
		}, {
			'$set': {
				onboarding: true,
			}
		});
	return dynamicResponse(req, res, 302, { redirect: '/account' });
};
