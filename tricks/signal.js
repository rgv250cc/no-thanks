// Global Privacy Control: tells sites not to sell or share your data. A browser rule sends the header.
Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true, enumerable: true, configurable: true });
