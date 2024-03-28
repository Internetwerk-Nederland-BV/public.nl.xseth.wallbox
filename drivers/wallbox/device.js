'use strict';

const Homey = require('homey');
const util = require('../../lib/util');
const status_util = require('../../lib/statuses');
const WallboxAPI = require('../../lib/wallbox_api');

const statuses = status_util.statuses;

const POLL_INTERVAL = 10;

class wallbox_charger extends Homey.Device {

  async onInit() {
    this.log('Device init: ', this.getName());
    let user = this.getSetting('user');
    let pass = this.getSetting('pass');

    this._name = this.getName();
    this._id = this.getData().id;
    this._api = new WallboxAPI(user, pass, this.homey);

    await this._api.authenticate();
    await this.registerCapabilities();
    await this.registerCapabilityListeners();
    await this.setupDevicePollingAndDoFirstPoll();
  }

  async registerCapabilities() {
    await this.removeUnusedCapabilities();

    if (!this.hasCapability('meter_power_session')) {
      await this.addCapability('meter_power_session');
    }
    if (!this.hasCapability('meter_session_cost')) {
      await this.addCapability('meter_session_cost');
    }
    if (!this.hasCapability('maximum_available_current')) {
      await this.addCapability('maximum_available_current');
    }
    if (!this.hasCapability('measure_maximum_charging_current')) {
      await this.addCapability('measure_maximum_charging_current');
    }
    if (!this.hasCapability('user_id')) {
      await this.addCapability('user_id');
    }
    if (!this.hasCapability('user_name')) {
       await this.addCapability('user_name');
    }
    if (!this.hasCapability('measure_energy_cost')) {
      await this.addCapability('measure_energy_cost');
    }
  }

  async removeUnusedCapabilities() {
    if (this.hasCapability('measure_current')) {
      await this.removeCapability('measure_current');
    }
    if (this.hasCapability('charge_amp')) {
      await this.removeCapability('charge_amp');
    }
    if (this.hasCapability('charge_amp_limit')) {
      await this.removeCapability('charge_amp_limit');
    }
    if (this.hasCapability('charging')) {
      await this.removeCapability('charging');
    }
  }

  async registerCapabilityListeners() {
    this.registerCapabilityListener('locked', this.turnLocked.bind(this));
    this.registerCapabilityListener('onoff', this.turnOnOff.bind(this));
  }

  async setupDevicePollingAndDoFirstPoll() {
    // Verify default polling frequenty is set
    if (!this.getSetting('polling'))
      this.setSettings({ polling: POLL_INTERVAL});

    // Setup polling of device
    this.polling = this.homey.setInterval(this.poll.bind(this), 1000 * this.getSetting('polling'));
    await this.poll();
  }

  onDeleted() {
    this.log("deleting device...", this._name);
    this.homey.clearInterval(this.polling);
  }

  async onSettings({oldSettings, newSettings, changedKeys}) {
    clearTimeout(this.polling);
    this.polling = this.homey.setInterval(this.poll.bind(this), 1000 * newSettings.polling);
  }

  async poll() {
    /**
     * Polling function for retrieving/parsing current status charger
     */
     const stats = await this.retrieveChargerStats();

     if(stats !== undefined) {
       await this.checkDeviceAvailability(stats);
       await this.whenChangedSetAndTriggerStatus(stats);
       await this.whenChangedSetCapabilities(stats);
     }
   }

   async retrieveChargerStats() {
    try {
      let stats = await this._api.getChargerStatus(this._id);
      return stats;
    } catch (error) {
      this.log(`Failed to get ChargerStatus: ${error}`)
      this.setUnavailable();
      return
    }
  }

  async checkDeviceAvailability(stats) {
    const newStatus = this.getChargerStatusName(stats);
    if (newStatus === 'Disconnected' || newStatus === 'Error') {
      await this.setUnavailable();
      this.log(`Device ${this._name} is unavailable (disconnected/error)`)
      return
    } else 
    return await this.setAvailable();
  }

  async whenChangedSetAndTriggerStatus(stats) {
    const oldStatus = this.getCapabilityValue('status');
    const newStatus = this.getChargerStatusName(stats);
    if (oldStatus !== newStatus) {
      this.log('Setting [status]: ', newStatus);
      this.setCapabilityValue('status', newStatus);

      this.triggerStatusChange(oldStatus, newStatus);
    }
  }

  async whenChangedSetCapabilities(stats) {
    let isLocked = Boolean(stats['config_data']['locked']);
    await this.whenChangedSetCapabilityValue('locked', isLocked);

    const newStatus = this.getChargerStatusName(stats);
    const isOnOff = newStatus !== 'Paused';
    await this.whenChangedSetCapabilityValue('onoff', isOnOff);

    const maxAvailableCurrent = stats['config_data']['max_available_current'];
    await this.whenChangedSetCapabilityValue('maximum_available_current', maxAvailableCurrent);

    const chargingPowerInW = stats['charging_power'] * 1000;
    await this.whenChangedSetCapabilityValue('measure_power', chargingPowerInW);

    const oldSessionEnergySupplied = this.getCapabilityValue('meter_power_session');
    const sessionEnergySupplied = stats['added_energy'];
    const energyCost = stats['config_data']['energy_price'];
    await this.whenChangedSetTotalEnergy(sessionEnergySupplied, oldSessionEnergySupplied)
    
    await this.whenChangedSetSessionCost(sessionEnergySupplied, oldSessionEnergySupplied, energyCost);
     
    await this.whenChangedSetCapabilityValue('meter_power_session', sessionEnergySupplied);

    await this.whenChangedSetCapabilityValue('measure_energy_cost', energyCost);

    const maxChargingCurrent = stats['config_data']['max_charging_current'];
    await this.whenChangedSetCapabilityValue('measure_maximum_charging_current', maxChargingCurrent);
    
    const userId = stats['user_id'].toString();
    await this.whenChangedSetCapabilityValue('user_id', userId);

    const userName = stats['user_name'];
    await this.whenChangedSetCapabilityValue('user_name', userName);
  }

  getChargerStatusName(stats) {
    let statusId = stats['status_id'];
    return status_util.getStatus(statusId);
  }

  async whenChangedSetCapabilityValue(capabilityName, currentCapabilityValue) {
    const oldCapabilityValue = this.getCapabilityValue(capabilityName);
    if (currentCapabilityValue !== oldCapabilityValue) {
        await this.setCapabilityValue(capabilityName, currentCapabilityValue);    
    }
  }

  async whenChangedSetTotalEnergy(currentSessionEnergySupplied, oldSessionEnergySupplied) {
    let totalEnergy = await this.retrieveEnergyHistoricalTotal();
    if(totalEnergy !== undefined) {
      if (currentSessionEnergySupplied + totalEnergy !== oldSessionEnergySupplied + totalEnergy) {
        await this.setCapabilityValue('meter_power', totalEnergy + currentSessionEnergySupplied);
      }
    }
  }

  async whenChangedSetSessionCost(currentSessionEnergySupplied, oldSessionEnergySupplied, energyCost) {
    const oldSessionCost = this.getCapabilityValue('meter_session_cost');

    let sessionCost = 0;
    if (currentSessionEnergySupplied < oldSessionEnergySupplied || currentSessionEnergySupplied === 0) {
      sessionCost = currentSessionEnergySupplied * energyCost;
    } else {
      sessionCost = oldSessionCost + (currentSessionEnergySupplied - oldSessionEnergySupplied) * energyCost;
    }

    if (oldSessionCost !== sessionCost) {
      await this.setCapabilityValue('meter_session_cost', sessionCost);
    }
  }

  async retrieveEnergyHistoricalTotal() {
    let sessions = await this._api.getSessionsList();
    let totalEnergy = 0;
    for (var session of sessions['data']) {
      if (session['attributes']['charger'] === this._id && session['attributes']['energy'] !== undefined) {
        totalEnergy += session['attributes']['energy'];
      }
    }
    return totalEnergy;
  }

  async triggerStatusChange(oldStatus, newStatus){
    /**
     * Fire homey triggers for status change
     * 
     * @param {String} oldStatus - previous Status before change
     * @param {String} newStatus - current Status
     */
     const tokens = {
      oldStatus: oldStatus,
      status: newStatus
    };

    this.driver.trigger('status_changed', this, tokens);

    // Ignore Error and Update triggers for now
    if (newStatus === 'Error' || newStatus === 'Updating')
      return;

    // Triggers based on change in previous status
    if (oldStatus === 'Charging')
      this.driver.trigger('charging_ended', this);
    else if (oldStatus ==='Ready')
      this.driver.trigger('car_connected', this);


    // Triggers based on change in current status
    if (newStatus === 'Charging')
      this.driver.trigger('charging_started', this);
    else if (newStatus ==='Ready')
      this.driver.trigger('car_unplugged', this);

  }

  async turnLocked(value) {
    /**
     * Lock or unlock charger
     *
     * @param {Boolean} value - to lock or unlock
     */
    let func;
    if (value)
      func = this._api.lockCharger(this._id);
    else
      func = this._api.unlockCharger(this._id);

    await func;
  }

  async turnOnOff(value) {
    /**
     * On (resume) or off (pause) charging
     *
     * @param {Boolean} value - to pause / resume charging
     */
    let func;

    if (value)
      func = this._api.resumeCharging(this._id);
    else
      func = this._api.pauseCharging(this._id);

    await func;
  }

  async setMaxChargingCurrent(amperage) {
    /**
     * Change ampere value for charging session
     *
     * @param {int} amperage - ampere to set charging to
     */
    await this._api.setMaxChargingCurrent(this._id, amperage);
  }
  
  async setEnergyCost(energyCost) {
    /**
     * Change energy cost value for charging session
     *
     * @param {float} energyCost - cost to set charging to
     */
    await this._api.setEnergyCost(this._id, energyCost);
  }
}

module.exports = wallbox_charger;