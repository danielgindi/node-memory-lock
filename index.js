"use strict";

var locks = {};

/** @enum {string}
 */
var Priority = {
    /**
     * A lock with an UNSPECIFIED priority will try to acquire the locks in the order that they arrived
     */
    UNSPECIFIED: 'unspecified',

    /**
     * A lock with a READ priority will grant priority to read-locks,
     * meaning that if there's a pending write lock, new read locks will still be acquired.
     */
    READ: 'read',

    /**
     * A lock with a WRITE priority will grant priority to read-locks,
     * meaning that if there's a pending write lock, new read locks will not be acquired.
     */
    WRITE: 'write'
};

/**
 * Normalizes a priority value
 * @param {Priority} priority
 * @returns {Priority}
 */
var getValidPriority = function (priority) {

    if (priority !== Priority.READ &&
        priority !== Priority.WRITE &&
        priority !== Priority.UNSPECIFIED) {
        return Priority.UNSPECIFIED;
    }

    return priority;

};

var MemoryLock = function ctor () {
    if (!(this instanceof ctor)) {
        var instance = Object.create(MemoryLock.prototype);
        (typeof this.init === 'function') && this.init.apply(this, args);
        return instance;
    }
    (typeof this.init === 'function') && this.init.apply(this, arguments);
};

/**
 * @public
 * @param {Object?} options
 * @param {String?} options.name The unique name for the lock
 * @param {Priority?} options.priority Priority policy, enum available in MemoryLock.Priority (UNSPECIFIED, READ, WRITE)
 */
MemoryLock.prototype.init = function (options) {

    var that = this;
    options = options || {};

    that.__name = options.name || null;
    var priority = that.__priority = getValidPriority(options.priority);

    that.__hasSplitLists = priority == Priority.READ || priority == Priority.WRITE;

    if (that.__hasSplitLists) {
        /** @member {Array?} */
        that.__readWaiters = [];

        /** @member {Array?} */
        that.__writeWaiters = [];
    } else {
        /** @member {Array?} */
        that.__waiters = [];
    }

    /** @member {Number} */
    that.__readLocks = 0;

    /** @member {Boolean} */
    that.__hasWriteLock = false;

    /** @member {Number} */
    that.__waitingWrite = 0;

    /** @member {Number} */
    that.__waitingRead = 0;

};

/**
 * Returns the relevant waiters list
 * @private
 * @param {Boolean} isWrite is this for a write lock or a read lock?
 * @returns {*}
 */
MemoryLock.prototype._getWaiterList = function (isWrite) {
    return this.__hasSplitLists ? (isWrite ? this.__writeWaiters : this.__readWaiters) : this.__waiters;
};

/**
 * This handles the "no" situation, creating the timeout if necessary or calling the callback
 * @private
 * @param timeout
 * @param callback
 * @param isWrite
 */
MemoryLock.prototype._handleNoLock = function (timeout, callback, isWrite) {

    var that = this;

    if (timeout !== 0) {
        var waiter = { cb: callback, w: isWrite, t: Date.now() };

        // Add this lock to the waiting list

        that._getWaiterList(isWrite).push(waiter);

        if (isWrite) {
            that.__waitingWrite++;
        } else {
            that.__waitingRead++;
        }

        // Create the timeout for this waiting lock

        if (timeout > 0) {
            waiter.to = setTimeout(function() {

                // Remove it from the waiter list
                that._getWaiterList(isWrite).remove(waiter);

                if (isWrite) {
                    that.__waitingWrite--;
                } else {
                    that.__waitingRead--;
                }

                // We cannot allow an exception here. We'll postpone them until after the lock's logic is done.
                var throwable = null;

                if (waiter.cb) {
                    try {
                        // Call with a global `this` and a 'timeout' error
                        waiter.cb.call(undefined, 'timeout');
                    } catch (e) {
                        throwable = e;
                    }
                }

                // It could be a write lock that has failed, and now read locks can be acquired...
                that._acquireWaitingLock();

                // Re-throw any error that came from the callback
                if (throwable) {
                    throw throwable;
                }

            }, timeout);
        }

    } else {

        if (callback) {
            // Call with a global `this` and a 'timeout' error
            callback.call('timeout');
        }

    }

};

/**
 * Looks for the next lock to acquire if any are waiting
 * @private
 */
MemoryLock.prototype._acquireWaitingLock = function () {

    var that = this;
    var waiter;

    if (that.__priority === Priority.READ) {

        // Priority for waiting readers
        if (that.__readWaiters.length) {

            // We can read-lock only if there are no write locks
            if (that.__hasWriteLock === false) {
                waiter = that.__readWaiters.shift();
                that.__waitingRead--;
            }

        } else if (that.__writeWaiters.length) {

            // Writers require exclusive lock
            if (that.__readLocks === 0 && that.__hasWriteLock === false) {
                waiter = that.__writeWaiters.shift();
                that.__waitingWrite--;
            }

        }

    } else if (that.__priority === Priority.WRITE) {

        // Priority for waiting writers.
        // If there are any writers waiting, don't let readers lock
        if (that.__writeWaiters.length) {

            // Writers require exclusive lock
            if (that.__readLocks === 0 && that.__hasWriteLock === false) {
                waiter = that.__writeWaiters.shift();
                that.__waitingWrite--;
            }

        } else if (that.__readWaiters.length) {

            // If a lock was released, it has been either an exclusive write-lock, or a non-exclusive read-lock.
            // In either case, we can add another read-lock because we know that there's no write lock now.
            waiter = that.__readWaiters.shift();
            that.__waitingRead--;
        }

    } else {

        var nextWaiter = that.__waiters[0];
        if (nextWaiter) {
            if (nextWaiter.w) {

                // Writers require exclusive lock
                if (that.__readLocks === 0 && that.__hasWriteLock === false) {
                    waiter = that.__waiters.shift();
                    that.__waitingWrite--;
                }

            } else {

                // Readers require that no writers are currently locking
                if (that.__hasWriteLock === false) {
                    waiter = that.__waiters.shift();
                    that.__waitingRead--;
                }

            }
        }

    }

    if (waiter) {

        if (waiter.w) {
            that.__hasWriteLock = true;
        } else {
            that.__readLocks++;
        }

        // We have a lock waiting, tell it it's ready
        if (waiter.to) {
            clearTimeout(waiter.to);
        }

        if (waiter.cb) {
            setTimeout(function () {
                // Call with a global `this` and no error
                waiter.cb.call();
            }, 0);
        }

        // Now if something was pulled out of the waiters list,
        // It could have been a read lock when we have more read locks pending.
        that._acquireWaitingLock();
    }

};

/**
 * Acquires a read lock.
 * @expose
 * If the lock could not be acquired after the timeout specified then it will fail and return 'timeout' in the callback error.
 * Argument combinations could be (timeout, callback), (timeout), or (callback) :
 * -> (timeout) Timeout after which the lock fails. A negative value will wait indefinitely, zero will fail immediately. (Defaults to -1 - indefinite)
 * -> (callback) The callback to call when the lock is acquired or failed
 * @returns {boolean} Was the lock acquired. If there's a timeout, it might return false and later call the callback with a success.
 */
MemoryLock.prototype.readLock = function () {

    var that = this;

    var timeout = arguments[0];
    var callback = arguments[1];
    if (typeof timeout === 'function') {
        callback = timeout;
        timeout = -1;
    }

    var allowLock = false;

    // Read locks require a read-only mode, no write locks at the same time
    if (that.__hasWriteLock === false) {

        // If no write-locks are waiting,
        // or if there are but the priority is on READ
        if (that.__waitingWrite === 0 ||
            that.__priority === Priority.READ) {
            allowLock = true;
        }
    }

    if (allowLock) {
        that.__readLocks++;
        if (callback) {
            callback();
        }
        return true;
    } else {
        that._handleNoLock(timeout, callback, false);
        return false;
    }
};

/**
 * Acquires a write lock.
 * If the lock could not be acquired after the timeout specified then it will fail and return 'timeout' in the callback error.
 * Argument combinations could be (timeout, callback), (timeout), or (callback) :
 * -> (timeout) Timeout after which the lock fails. A negative value will wait indefinitely, zero will fail immediately. (Defaults to -1 - indefinite)
 * -> (callback) The callback to call when the lock is acquired or failed
 * @expose
 * @returns {boolean} Was the lock acquired. If there's a timeout, it might return false and later call the callback with a success.
 */
MemoryLock.prototype.writeLock = function () {

    var that = this;

    var timeout = arguments[0];
    var callback = arguments[1];
    if (typeof timeout === 'function') {
        callback = timeout;
        timeout = -1;
    }

    // Write locks require exclusive access, regardless of priority
    var allowLock = that.__hasWriteLock === false && that.__readLocks === 0;

    if (allowLock) {
        that.__hasWriteLock = true;
        if (callback) {
            callback();
        }
        return true;
    } else {
        that._handleNoLock(timeout, callback, true);
        return false;
    }
};

/**
 * Releases a read lock
 * @expose
 * @returns {boolean} Was it unlocked successfully
 */
MemoryLock.prototype.readUnlock = function () {
    if (this.__readLocks === 0) {
        console.log('Fatal error: readUnlock() called when there are no read locks.');
        return false;
    } else {
        this.__readLocks--;

        this._acquireWaitingLock();

        return true;
    }
};

/**
 * Releases a write lock
 * @expose
 * @returns {boolean} Was it unlocked successfully
 */
MemoryLock.prototype.writeUnlock = function () {
    if (this.__hasWriteLock === false) {
        console.log('Fatal error: writeUnlock() called when there is no write lock.');
        return false;
    } else {
        this.__hasWriteLock = false;

        this._acquireWaitingLock();

        return true;
    }
};

/**
 * Tries to upgrade a single read-lock to a write-lock.
 *
 *   If there is more than one read lock, or no read locks at all,
 *   or if there is a write lock already - then it will fail immediately and return false.
 *   Otherwise it will succeed immediately and return true.
 *
 * @expose
 * @returns {boolean} Did the upgrade succeed?
 */
MemoryLock.prototype.upgradeToWriteLock = function () {
    if (this.__hasWriteLock === false && this.__readLocks === 1) {
        this.__readLocks = 0;
        this.__hasWriteLock = true;
        return true;
    }
    return false;
};

/**
 * Tries to downgrade a write-lock to a read-lock.
 *
 *   If there is no write lock it will fail immediately and return false.
 *   Otherwise it will succeed immediately and return true.
 *
 * @expose
 * @returns {boolean} Did the downgrade succeed?
 */
MemoryLock.prototype.downgradeToReadLock = function () {
    if (this.__hasWriteLock === true) {
        this.__readLocks = 1;
        this.__hasWriteLock = false;

        // Look for more read locks...
        this._acquireWaitingLock();

        return true;
    }
    return false;
};

/**
 * Gets or sets the priority for the locker

 @name MemoryLock.prototype#priority
 @type Priority
 @default Priority.UNSPECIFIED
 */
Object.defineProperty(MemoryLock.prototype, 'priority', {
    get: function () { return this.__priority; },
    set: function (newValue) {
        newValue = getValidPriority(newValue);

        var newHasSplitLists = newValue == Priority.READ || newValue == Priority.WRITE;
        if (newHasSplitLists !== this.__hasSplitLists) {
            this.__hasSplitLists = newHasSplitLists;
            if (this.__waiters) {
                this.__readWaiters = [];
                this.__writeWaiters = [];
                for (var i = 0, len = this.__waiters.length; i < len; i++) {
                    var waiter = this.__waiters[i];
                    if (waiter.w) {
                        this.__readWaiters.push(waiter);
                    } else {
                        this.__writeWaiters.push(waiter);
                    }
                }
                this.__waiters = null;
            } else {
                this.__waiters = this.__readWaiters.concat(this.__writeWaiters);
                this.__waiters.sort(function (a, b) {
                    if (a.t < b.t) return -1;
                    if (a.t > b.t) return 1;
                    return 0;
                });
                this.__readWaiters = this.__writeWaiters = null;
            }
        }
    }
});

Object.defineProperties(MemoryLock.prototype, {

    /**
     * Retrieves the count of the read locks on the object.

     @name MemoryLock.prototype#currentReadLocks
     @type Number
     */

    'currentReadLocks': {
        get: function () { return this.__readLocks; }
    },

    /**
     * Returns true if the object is write-locked

     @name MemoryLock.prototype#hasWriteLock
     @type Boolean
     */

    'hasWriteLock': {
        get: function () { return this.__hasWriteLock; }
    },

    /**
     * Retrieves the count of the pending read locks on the object.

     @name MemoryLock.prototype#pendingReadLocks
     @type Number
     */

    'pendingReadLocks': {
        get: function () { return this.__waitingRead; }
    },

    /**
     * Retrieves the count of the pending write locks on the object.

     @name MemoryLock.prototype#pendingWriteLocks
     @type Number
     */

    'pendingWriteLocks': {
        get: function () { return this.__waitingWrite; }
    }
});

/**
 * @public
 * @param {Object?} options
 * @param {String?} options.name The unique name for the lock
 * @param {Priority?} options.priority Priority policy, enum available in MemoryLock.Priority (UNSPECIFIED, READ, WRITE)
 * @returns {MemoryLock} The locker object
 */
var lockFactory = function (options) {
    return (options && options.name) ?
        locks[options.name] || (locks[options.name] = new MemoryLock(options.priority)) :
        new MemoryLock(options);
};

/**
 * @expose
 * */
module.exports = lockFactory;

/** @expose */
module.Priority = Priority;

/** @expose */
MemoryLock.Priority = Priority;