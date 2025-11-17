const EventEmitter = require('events');
const logger = require('./logger');

class ProgressTracker extends EventEmitter {
  constructor() {
    super();
    this.state = {
      phase: 'init',
      message: 'Starting dashboard services',
      percentage: 0,
      ready: false,
      lastUpdate: new Date().toISOString()
    };
    this.lastLoggedSignature = '';
  }

  update(partial = {}) {
    const updatedState = {
      ...this.state,
      ...partial,
      percentage: typeof partial.percentage === 'number'
        ? Math.max(0, Math.min(100, partial.percentage))
        : this.state.percentage,
      lastUpdate: new Date().toISOString()
    };

    this.state = updatedState;
    this.emit('update', this.state);
    this.logIfChanged();
  }

  logIfChanged() {
    const { phase, message, percentage } = this.state;
    const signature = `${phase}|${Math.round(percentage)}|${message}`;
    if (signature === this.lastLoggedSignature) {
      return;
    }
    this.lastLoggedSignature = signature;

    const filled = Math.min(20, Math.max(0, Math.round((percentage || 0) / 5)));
    const bar = `${'#'.repeat(filled)}${'.'.repeat(20 - filled)}`;
    logger.info(`[STARTUP] [${bar}] ${Math.round(percentage || 0)}% - ${message}`);
  }

  getState() {
    return { ...this.state };
  }

  reset(state = {}) {
    this.lastLoggedSignature = '';
    this.state = {
      phase: 'init',
      message: 'Starting dashboard services',
      percentage: 0,
      ready: false,
      lastUpdate: new Date().toISOString(),
      ...state
    };
    this.logIfChanged();
  }
}

module.exports = new ProgressTracker();
