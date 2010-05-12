var http = require("http"),
    elf = require("../lib/elf-logger"),
    responseString = "Hello World!\nNow go look in the 'log' folder to see logging output.";

// Create a simple, standard Node HTTP server.
var httpServer = http.createServer(function (req, res) {
    res.writeHead(200, {
        "Content-Type": "text/plain;charset=utf-8",
        "Content-Length": responseString.length,
    });
    res.write(responseString, "utf8");
    res.end();
});
// Begin listening on port 8080.
httpServer.listen(8080);


// You may pass an 'options' argument with a 'stream' property. It's value
// should be a WritableStream to write logging output to.  If a 'stream' prop
// is present, only the 'stream' and 'fields' are valid.
var stdoutLog = elf.createLogger(httpServer, {
    // This logger will print all logging output to 'stdout'
    stream: process.stdout,
    // Log only a few fields
    fields: ['date','time','c-ip','cs-method','cs-uri','sc-status']
});


// For better organization, and log-splitting, etc., you would probably rather
// supply a 'template' (and maybe 'dir') properties. The 'template' should be
// a function that is called for each log entry and should return the path and
// name of file that the entry should log to. The function is passed the
// entry's #Fields as an object literal for an argument. The 'dirs' prop, if
// present, will prefix the 'dir' value before the 'template' value to
// determine the actual log file location.
var filesystemLog = elf.createLogger(httpServer, {
    template: function(fields) {
        var name = "";
        
        if (fields['cs(host)']) {
            var index = fields['cs(host)'].indexOf(":");
            name += index >= 0 ? fields['cs(host)'].substring(0, index) : fields['cs(host)'];
        } else {
            name += "no-host";
        }
        name += "/";
        
        name += fields['date'] + ".log";
        return name;
    },
    dir: 'logs',
    fields: ['date','time','c-ip','cs-method','cs-uri','sc-status']
});


// And finally, you may pass a String to the 'template' property, which may
// contain the names of individual #Fields values, surrounded by {}s. For
// each entry, the {} field will be replaced with the entry's actual value in
// order to determine which log file the entry should be recorded to.
var methodLog = elf.createLogger(httpServer, {
    template: "METHOD/{cs-method}.log",
    dir: 'logs',
    fields: ['date','time','c-ip','cs-uri','sc-status','cs(host)']
});
