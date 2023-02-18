const db = require('../db.js');
const acme = require('../acme.js');
const url = require('url');
const { dynamicResponse } = require('../util.js');

/**
 * GET /domains
 * domains page
 */
exports.domainsPage = async (app, req, res) => {
	return app.render(req, res, '/domains', {
		csrf: req.csrfToken(),
	});
};

/**
 * GET /domains.json
 * domains json data
 */
exports.domainsJson = async (req, res) => {
	return res.json({
		csrf: req.csrfToken(),
		user: res.locals.user,
	});
};

/**
 * POST /domain/add
 * add domain
 */
exports.addDomain = async (req, res) => {

	if (!req.body.domain || typeof req.body.domain !== 'string' || req.body.domain.length === 0) {
		return dynamicResponse(req, res, 400, { error: 'Invalid input' });
	}

	try {
		const { hostname } = url.parse(`https://${req.body.domain}`);
	} catch (e) {
		return dynamicResponse(req, res, 400, { error: 'Invalid input' });
	}

	const { csr, key, cert, haproxyCert, date } = await acme.generate(req.body.domain);
	const fd = new FormData();
	fd.append('file_upload', new Blob([haproxyCert], { type: 'text/plain' }), `${req.body.domain}.pem`);
	await fetch(`${res.locals.dataPlane.defaults.baseURL}/services/haproxy/storage/ssl_certificates`, {
			method: 'POST',
			headers: { 'authorization': res.locals.dataPlane.defaults.headers.authorization },
			body: fd,
		})
		.then(res => res.text())
		.then(res => console.log(res))
	const account = await db.db.collection('certs')
		.replaceOne({
			_id: req.body.domain,
		}, {
			_id: req.body.domain,
			username: res.locals.user.username,
			csr, key, cert, haproxyCert,
			date,
		}, {
			upsert: true,
		});
	//TODO: mongodb encryption
	//TODO: make upload to all user clusters/servers
	//TODO: add scheduled task to aggregate domains and upload certs to clusters of that username through dataplane
	//TODO: make scheduled task also run this again for certs close to expiry and repeat ^

	await db.db.collection('accounts')
		.updateOne({_id: res.locals.user.username}, {$addToSet: {domains: req.body.domain }});

	return dynamicResponse(req, res, 302, { redirect: '/domains' });
};

/**
 * POST /domain/delete
 * delete domain
 */
exports.deleteDomain = async (req, res) => {

	if (!req.body.domain || typeof req.body.domain !== 'string' || req.body.domain.length === 0
		|| !res.locals.user.domains.includes(req.body.domain)) {
		return dynamicResponse(req, res, 400, { error: 'Invalid input' });
	}

	//will fail if domain is only in the hosts map for a different cluster, so we wont do it (for now)
	//but will cause permission problems "invalid input" when trying to delete it from the other cluster later... hmmm...

	await db.db.collection('accounts')
		.updateOne({_id: res.locals.user.username}, {$pull: {domains: req.body.domain }});

	return dynamicResponse(req, res, 302, { redirect: '/domains' });

};
