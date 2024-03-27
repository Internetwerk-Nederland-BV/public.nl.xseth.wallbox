'use strict';

const inspector = require('inspector');
const Homey = require('homey');

class wallboxapp extends Homey.App {

	onInit() {

		if (process.env.DEBUG === '1')
			inspector.open(8080, '0.0.0.0', true)

		this.log('wallboxapp is running...');

		this.log('Setting up actions')
		this.homey.flow.getActionCard('resume_charging')
			.registerRunListener(args => args.device.turnOnOff(true));
		this.homey.flow.getActionCard('pause_charging')
			.registerRunListener(args => args.device.turnOnOff(false));
		this.homey.flow.getActionCard('change_ampere')
			.registerRunListener(args => args.device.setMaxChargingCurrent(args.ampere));
	}
}

module.exports = wallboxapp;
