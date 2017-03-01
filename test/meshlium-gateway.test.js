/* global describe, it, after, before */
'use strict'

const mqtt = require('mqtt')
const async = require('async')
const should = require('should')

const PORT = 8182
const PLUGIN_ID = 'demo.gateway'
const BROKER = 'amqp://guest:guest@127.0.0.1/'
const OUTPUT_PIPES = 'demo.outpipe1,demo.outpipe2'
const COMMAND_RELAYS = 'demo.relay1,demo.relay2'

const Broker = require('../node_modules/reekoh/lib/broker.lib')

let conf = {
  port: PORT,
  user: 'hello',
  password: 'world',
  deviceId1: 'AGP_1',
  deviceId2: 'AGP_2',
  topic: 'hello/world'
}

let _app = null
let _broker = null

let mqttGateway = null
let mqttClient1 = null
let mqttClient2 = null

describe('Meshlium Gateway', () => {
  before('init', () => {
    process.env.BROKER = BROKER
    process.env.PLUGIN_ID = PLUGIN_ID
    process.env.OUTPUT_PIPES = OUTPUT_PIPES
    process.env.COMMAND_RELAYS = COMMAND_RELAYS
    process.env.CONFIG = JSON.stringify(conf)

    _broker = new Broker()
  })

  after('terminate', function () {
    // mqttClient1.end(true)
    // mqttClient2.end(true)

    // mqttGateway.send({
    //   type: 'close'
    // })

    setTimeout(function () {
      mqttGateway.kill('SIGKILL')
    }, 4500)
  })

  describe('#start', function () {
    it('should start the app', function (done) {
      this.timeout(10000)
      _app = require('../app')
      _app.once('init', done)
    })
  })

  describe('#test RPC preparation', () => {
    it('should connect to broker', (done) => {
      _broker.connect(BROKER).then(() => {
        return done() || null
      }).catch((err) => {
        done(err)
      })
    })

    it('should spawn temporary RPC server', (done) => {
      // if request arrives this proc will be called
      let sampleServerProcedure = (msg) => {
        // console.log(msg.content.toString('utf8'))
        return new Promise((resolve, reject) => {
          async.waterfall([
            async.constant(msg.content.toString('utf8')),
            async.asyncify(JSON.parse)
          ], (err, parsed) => {
            if (err) return reject(err)
            parsed.foo = 'bar'
            resolve(JSON.stringify(parsed))
          })
        })
      }

      _broker.createRPC('server', 'deviceinfo').then((queue) => {
        return queue.serverConsume(sampleServerProcedure)
      }).then(() => {
        // Awaiting RPC requests
        done()
      }).catch((err) => {
        done(err)
      })
    })
  })

  describe('#connections', function () {
    it('should accept connections', function (done) {
      mqttClient1 = mqtt.connect('mqtt://localhost' + ':' + PORT, {
        clientId: conf.deviceId1,
        protocolId: 'MQTT',
        protocolVersion: 4,
        username: conf.user,
        password: conf.password
      })

      mqttClient2 = mqtt.connect('mqtt://localhost' + ':' + PORT, {
        clientId: conf.deviceId2,
        protocolId: 'MQTT',
        protocolVersion: 4,
        username: conf.user,
        password: conf.password
      })

      async.parallel([
        function (cb) {
          mqttClient1.on('connect', cb)
        },
        function (cb) {
          mqttClient2.on('connect', cb)
        }
      ], function () {
        done()
      })
    })
  })

  describe('#clients', function () {
    it('should relay messages', function (done) {

      mqttClient1.once('message', function (topic, message) {
        message = JSON.parse(message)

        should.equal(conf.topic, topic)
        should.equal(message.id, '15819', 'ID validation failed.')
        should.equal(message.id_wasp, 'AGP_2', 'Wasp ID validation failed.')
        should.equal(message.id_secret, '400577471', 'Secret ID validation failed.')
        should.equal(message.sensor, 'SOIL_D', 'Sensor ID validation failed.')
        should.equal(message.value, '52.48', 'Sensor Value validation failed.')
        should.equal(message.datetime, '2016-01-28T12:29:11+10:00', 'Reading date/time validation failed.')

        return done()
      })

      mqttClient1.subscribe([conf.topic, conf.deviceId1], function (error) {
        should.ifError(error)
        mqttClient2.publish(conf.topic, '{"id":"15819","id_wasp":"AGP_2","id_secret":"400577471","sensor":"SOIL_D","value":"52.48","datetime":"2016-01-28T12:29:11+10:00"}')
      })
    })

    it('should be piped to platform', function (done) {
      _app.on('piped', done)
    })
  })
})
