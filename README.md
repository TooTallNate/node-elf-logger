node-elf-logger
===============

This library is a simple, configurable, [node.js](http://github.com/ry/node)
HTTP server compatible logging implementation that complies with the
[W3C's Extended Log File Format][spec]. Major HTTP servers like IIS and Apache
have options to follow this logging format, and that has the advantage of log
viewing software that has already been written for this format.

---

**node-elf-logger** is configurable. Specifically which `#Fields` should be
logged, whether to write to a stream or file, and the log folder and file
naming (organization). First look at a minimal example:

    var http = require("http"),
        elf = require("elf-logger");
    var httpServer = http.createServer(function (req, res) {
        // blah, blah
    });
    httpServer.listen(80);
    elf.createLogger(httpServer);

This will make the **node-elf-logger** log all requests to the `httpServer`
instance using the `elf.defaultOptions` object. That is all that is needed to
get it going!

---

No doubt you are more interested in the configuration options of
**node-elf-logger**. Supplying a second argument to the `elf.createLogger`
function uses the options specified instead of the `elf.defaultOptions`:

    elf.createLogger(httpServer, {
        dir: "/var/log/node/http",
        template: "{cs(host)}/{date}.log",
        fields: ['date','time','c-ip','cs-method','cs-uri','sc-status','cs(user-agent)']
    });

###Options Argument###

**dir**: The root directory where **node-elf-logger** should store it's log
files. This value will be prefixed onto the *template* value if present.

**template**: Defines where each HTTP request should be logged it. This can be
a String as shown above, with special filter values surrounded by `{}`
brackets. A `/` indicates a directory change.

For more fine-grained control, you may pass a `function` reference instead.
This function will be called after every HTTP request has completed, and a
log entry is about to be written. The function will be passed the `#Fields` as
an object literal as an argument, and your function must return the path and
name of log to write the entry to. You may also cancel a log entry by
returning a "falsey" value.

**stream**: A ready `WritableStream` to log all HTTP requests to, instead of
logging to a file. Supplying this property bypasses the *dir* and
*template* properties, if present.

**fields**: The `#Fields` that should be logged as defined by the
[W3C Specification][spec]. Also look at
[these examples](http://www.microsoft.com/technet/prodtechnol/WindowsServer2003/Library/IIS/ffdd7079-47be-4277-921f-7a3a6e610dcb.mspx?mfr=true)
for some more ideas for fields to log. The value should be an Array of
case-insensitive Strings containing an individual field to log per Array entry.

[spec]: http://www.w3.org/TR/WD-logfile.html

