node-elf-logger
---------------

This library is a simple, configurable, [node.js](http://github.com/ry/node) HTTP server compatible logging implementation that complies with the [W3C's Extended Log File Format][spec]. Major HTTP servers like IIS have options to follow this logging format, and has the advantage of viewing software that has already been written for these formats.

---

**node-elf-logger** is configurable. Specifically which `#Fields` should be logged, the log files' names and folder structure, and when the logs should split. First look at a minimal example:

    var http = require("http"),
        elf = require("elf-logger");
    var httpServer = http.createServer(function (req, res) {
        // blah, blah
    }).listen(80);
    elf.log(httpServer);

This will make the **node-elf-logger** log all calls to the `httpServer` instance using the `elf.defaultOptions` object. That is all that is needed to get it going!

---

No doubt you are more interested in the configuration options of **node-elf-logger**. Well by adding a second argument to the `elf.log` function, we can override any of the `elf.defaultOptions`:

    elf.log(httpServer, {
        dir: "/var/log/node/http",
        fields: ['date','time','c-ip','cs-method','cs-uri','sc-status','cs(User-Agent)'],
        nameFormat: "{cs(Host)}/{date}.log",
        splitLogs: {
            interval: 'daily'
            size: 1024000 // Max 1 megabyte log size
        }
    });

###Options Argument###

**dir**: The root directory where **node-elf-logger** should store it's log files.

**fields**: The `#Fields` that should be logged as defined by the [W3C Specification][spec]. Also look at [these examples](http://www.microsoft.com/technet/prodtechnol/WindowsServer2003/Library/IIS/ffdd7079-47be-4277-921f-7a3a6e610dcb.mspx?mfr=true) for some more ideas for fields to log. The value should be an Array of Strings containing an individual field to log per Array entry.

**nameFormat**: The structure of the logs inside the root *dir*. This can be a String as shown above, with special filter values surrounded by `{}` brackets. A `/` indicates a directory change.

For more fine-grained control, you may pass a `function` reference to *nameFormat*. This function will be called after every HTTP request has completed, and a log entry is about to be written. The function will be passed the `request` and `response` instances as arguments, and your function must return the relative String path to log to write the entry to. You may also cancel a log entry by returning a falsey value.

[spec]: http://www.w3.org/TR/WD-logfile.html

