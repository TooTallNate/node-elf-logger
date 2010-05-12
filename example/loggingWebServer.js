var http = require("http"),
    elf = require("../lib/elf-logger"),
    responseString = "Hello World!\nNow go look in the './log' folder to see logging output.";

var httpServer = http.createServer(function (req, res) {
    res.writeHead(200, {
        "Content-Type": "text/plain;charset=utf-8",
        "Content-Length": responseString.length,
    });
    res.write(responseString, "utf8");
    res.end();
});
httpServer.listen(8080);


// You may pass an 'options' argument with a 'stream'
// property. It's value should be a WritableStream to
// write logging output to.  If a 'stream' prop is
// present, only the 'stream' and 'fields' are valid.
//var stdoutLog = elf.createLogger(httpServer, {
    // This logger will print all logging output to 'stdout'
//    stream: process.stdout,
    // Log only a few fields
//    fields: ['date','time','c-ip','cs-method','cs-uri','sc-status']
//});


// Omitting the second 'options' argument creates
// a logger instance with elf.defaultOptions
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
