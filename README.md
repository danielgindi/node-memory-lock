# node-memory-lock

[![npm Version](https://badge.fury.io/js/memory-lock.png)](https://npmjs.org/package/memory-lock)

A memory-base read-write lock for Node.js.

**Note**: Contrary to other lockers available for Node.js, this one is memory-based, meaning that it will not work across separate processes.

Sometimes, with all of those callbacks and having multiple users working simultaneously, we might need a lock, to make sure that a certain flow will run once at a time. Or maybe something more fine tuned like reader-writer lock.

Assuming you called `var MemoryLock = require('memory-lock');`,
To create a lock object, call `var lock = MemoryLock()`.
You can pass a `name` argument if you want to retrieve an existing lock with the same name.
You can pass a `priority` argument to set read/write priority.

Priority is one of `MemoryLock.Priority.UNSPECIFIED` *(default)*, `MemoryLock.Priority.READ`, `MemoryLock.Priority.WRITE`.

A locker's methods and properties are:

Name | Explanation
---- | ------------
  `readLock([timeout, ][callback]):boolean` | Acquire a read lock (*timeout* defaults to `-1`)
  `writeUnlock([timeout, ][callback]):boolean` | Acquire a write lock (*timeout* defaults to `-1`)
  `readUnlock():boolean` | Release a read lock
  `writeUnlock():boolean` | Release a write lock
  `upgradeToWriteLock():boolean` | Try to upgrade a read lock to a write lock. It take place immediately, and returns `true`/`false` as a success value.
  `downgradeToReadLock():boolean` | Try to downgrade a write lock to a read lock. It take place immediately, and returns `true`/`false` as a success value.
  `priority:MemoryLock.Priority` | Get/set the lock's priority at any time
  `currentReadLocks:Number` | Get the number of current read locks
  `hasWriteLock:Number` | Returns true if there's a write lock
  `pendingReadLocks:Number` | Get the number of pending read locks
  `pendingWriteLocks:Number` | Get the number of pending write locks

*How timeouts work on locks:*
A negative timeout means "indefinitely".
A timeout of `0` will fail immediately in case there's no way to immediately acquire the lock.
The lock method's return value always tells you only if the lock was acquired. The return value can be `false` and still it will be acquired later automatically, as long as the timeout has not passed yet.

Usage example:
```javascript
var MemoryLock = require('memory-lock');

.
.
.

async.series([
        function (callback) {
            locker.writeLock(15000, callback);
        },
        .
        .
        .
        function (callback) {
            locker.writeUnlock();
        }
    ],
    function finishLine (error) {
        ...
    }
);

```


## Contributing

If you have anything to contribute, or functionality that you luck - you are more than welcome to participate in this!
If anyone wishes to contribute unit tests - that also would be great :-)

## Me
* Hi! I am Daniel Cohen Gindi. Or in short- Daniel.
* danielgindi@gmail.com is my email address.
* That's all you need to know.

## Help

If you want to buy me a beer, you are very welcome to
[![Donate](https://www.paypalobjects.com/en_US/i/btn/btn_donate_LG.gif)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=G4DXZS34VMS7A)
 Thanks :-)

## License

All the code here is under MIT license. Which means you could do virtually anything with the code.
I will appreciate it very much if you keep an attribution where appropriate.

    The MIT License (MIT)

    Copyright (c) 2013 Daniel Cohen Gindi (danielgindi@gmail.com)

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.
