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
		this.homey.flow.getActionCard('change_measure_maximum_charging_current')
			.registerRunListener(args => args.device.setMaxChargingCurrent(args.ampere));
		this.homey.flow.getActionCard('change_measure_energy_cost')
			.registerRunListener(args => args.device.setEnergyCost(args.energyCost));
	}
}

module.exports = wallboxapp;
