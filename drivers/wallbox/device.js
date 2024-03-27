'use strict';

const Homey = require('homey');
const util = require('../../lib/util');
const status_util = require('../../lib/statuses');
const WallboxAPI = require('../../lib/wallbox_api');

const statuses = status_util.statuses;

const POLL_INTERVAL = 15;

class wallbox_charger extends Homey.Device {

  async onInit() {
    this.log('Device init: ', this.getName());
    let user = this.getSetting('user');
    let pass = this.getSetting('pass');

    this._name = this.getName();
    this._id = this.getData().id;
    this._api = new WallboxAPI(user, pass, this.homey);

    await this._api.authenticate();
    await this.registerCapabilityListeners();
    await this.setupDevicePollingAndDoFirstPoll();
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
    if (newStatus == 'Disconnected' || newStatus == 'Error') {
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
    const lockedStatus = this.getCapabilityValue('locked');
    await this.whenChangedSetCapabilityValue(isLocked, lockedStatus);

    const newStatus = this.getChargerStatusName(stats);
    const isOnOff = newStatus != 'Paused';
    const onOffStatus = this.getCapabilityValue('onoff');
    await this.whenChangedSetCapabilityValue(isOnOff, onOffStatus);

    const chargingPowerInKW = stats['charging_power'];
    const chargingPowerInW = chargingPowerInKW * 1000;
    await this.whenChangedSetCapabilityValue('measure_power', chargingPowerInW);

    const sessionEnergySupplied = stats['added_energy'];     
    await this.whenChangedSetCapabilityValue('meter_power', sessionEnergySupplied);

    const maxChargingCurrent = stats['config_data']['max_charging_current'];
    await this.whenChangedSetCapabilityValue('measure_current', maxChargingCurrent);
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

  async triggerStatusChange(curStatus, newStatus){
    /**
     * Fire homey triggers for status change
     * 
     * @param {String} curStatus - current Status
     * @param {String} newStatus - new Status
     */
    const tokens = {
      status: newStatus
    };

    this.driver.trigger('status_changed', this, tokens);

    // Ignore Error and Update triggers for now
    if (newStatus == 'Error' || newStatus == 'Updating')
      return;

    // Triggers based on change in previous status
    if (curStatus == 'Charging')
      this.driver.trigger('charging_ended', this);
    else if (curStatus == 'Ready')
      this.driver.trigger('car_connected', this);


    // Triggers based on change in current status
    if (newStatus == 'Charging')
      this.driver.trigger('charging_started', this);
    else if (newStatus == 'Ready')
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
}

module.exports = wallbox_charger;