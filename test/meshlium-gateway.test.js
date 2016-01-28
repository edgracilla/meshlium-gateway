'use strict';

const PORT       = 8000,
	  TOPIC      = 'hello/world',
	  USER       = 'hello',
	  PASSWORD   = 'world',
	  DEVICE_ID1 = 'AGP_1',
	  DEVICE_ID2 = 'AGP_2';

var cp     = require('child_process'),
	mqtt   = require('mqtt'),
	async  = require('async'),
	should = require('should'),
	mqttGateway, mqttClient1, mqttClient2;

describe('Gateway', function () {
	this.slow(5000);

	after('terminate child process', function () {
		this.timeout(5000);

		mqttClient1.end(true);
		mqttClient2.end(true);

		mqttGateway.send({
			type: 'close'
		});

		setTimeout(function () {
			mqttGateway.kill('SIGKILL');
		}, 4500);
	});

	describe('#spawn', function () {
		it('should spawn a child process', function () {
			should.ok(mqttGateway = cp.fork(process.cwd()), 'Child process not spawned.');
		});
	});

	describe('#handShake', function () {
		it('should notify the parent process when ready within 5 seconds', function (done) {
			this.timeout(5000);

			mqttGateway.on('message', function (message) {
				if (message.type === 'ready')
					done();
			});

			mqttGateway.send({
				type: 'ready',
				data: {
					options: {
						port: PORT,
						topic: TOPIC,
						user: USER,
						password: PASSWORD
					},
					devices: [{_id: DEVICE_ID1}, {_id: DEVICE_ID2}]
				}
			}, function (error) {
				should.ifError(error);
			});
		});
	});

	describe('#connections', function () {
		it('should accept connections', function (done) {
			mqttClient1 = mqtt.connect('mqtt://localhost' + ':' + PORT, {
				clientId: DEVICE_ID1,
				protocolId: 'MQTT',
				protocolVersion: 4,
				username: USER,
				password: PASSWORD
			});

			mqttClient2 = mqtt.connect('mqtt://localhost' + ':' + PORT, {
				clientId: DEVICE_ID2,
				protocolId: 'MQTT',
				protocolVersion: 4,
				username: USER,
				password: PASSWORD
			});

			async.parallel([
				function (cb) {
					mqttClient1.on('connect', cb);
				},
				function (cb) {
					mqttClient2.on('connect', cb);
				}
			], function () {
				done();
			});
		});
	});

	describe('#clients', function () {
		it('should relay messages', function (done) {
			mqttClient1.once('message', function (topic, message) {
				message = JSON.parse(message);

				should.equal(TOPIC, topic);
				should.equal(message.id, '15819', 'ID validation failed.');
				should.equal(message.id_wasp, 'AGP_2', 'Wasp ID validation failed.');
				should.equal(message.id_secret, '400577471', 'Secret ID validation failed.');
				should.equal(message.sensor, 'SOIL_D', 'Sensor ID validation failed.');
				should.equal(message.value, '52.48', 'Sensor Value validation failed.');
				should.equal(message.datetime, '2016-01-28T12:29:11+10:00', 'Reading date/time validation failed.');

				return done();
			});

			mqttClient1.subscribe([TOPIC, DEVICE_ID1], function (error) {
				should.ifError(error);

				mqttClient2.publish(TOPIC, '{"id":"15819","id_wasp":"AGP_2","id_secret":"400577471","sensor":"SOIL_D","value":"52.48","datetime":"2016-01-28T12:29:11+10:00"}');
			});
		});
	});
});