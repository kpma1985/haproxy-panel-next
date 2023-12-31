'use strict';

const Redis = require('ioredis')
	, client = new Redis({
		host: process.env.REDIS_HOST || '127.0.0.1',
		port: process.env.REDIS_PORT || 6379,
		password: process.env.REDIS_PASS || '',
		db: 0,
	})
	, lockClient = new Redis({
		host: process.env.REDIS_HOST || '127.0.0.1',
		port: process.env.REDIS_PORT || 6379,
		password: process.env.REDIS_PASS || '',
		db: 1,
	});

module.exports = {

	client,
	lockClient,

	close: () => {
		client.quit();
		lockClient.quit();
	},

	//get a value with key
	get: (key) => {
		return client.get(key).then(res => { return JSON.parse(res); });
	},

	//get a hash value
	hgetall: (key) => {
		return client.hgetall(key).then(res => { return res });
	},

	//get a hash value
	hget: (key, hash) => {
		return client.hget(key, hash).then(res => { return JSON.parse(res); });
	},

	//set a hash value
	hset: (key, hash, value) => {
		return client.hset(key, hash, JSON.stringify(value));
	},

	//delete a hash
	hdel: (key, hash) => {
		return client.hdel(key, hash);
	},

	//set a value on key
	set: (key, value) => {
		return client.set(key, JSON.stringify(value));
	},

	//delete value with key
	del: (keyOrKeys) => {
		if (Array.isArray(keyOrKeys)) {
			return client.del(...keyOrKeys);
		} else {
			return client.del(keyOrKeys);
		}
	},

};
