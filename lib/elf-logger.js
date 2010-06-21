var fs = require("fs"),
    url = require("url"),
    path = require("path"),
    Buffer = require("buffer").Buffer;


// The default options that are used if not specified in your
// custom options argument.
exports.defaultOptions = {
    dir: "./log",
    template: "{date}.log",
    fields: [ 'date', 'time', 'c-ip', 's-ip', 's-port', 'cs-method', 'cs-uri',
              'cs-uri-stem', 'cs-uri-query', 'sc-status', 'cs(User-Agent)',
              'cs(Referer)']
};

// 'createLogger' is the function to call to have elf-logger start
// monitoring requests and responses on a Node HTTP server instance
exports.createLogger = function(httpServer, options) {
    options = options || {};
    options.__proto__ = exports.defaultOptions;
    return new ElfLogger(httpServer, options);
};



// Placeholder for function that gets defined inside the
// "native HTTP scope" right below this.
var isServer;

// We need to modify the standard 'http' library a little bit, to hook into
// logging events that otherwise aren't exposed.
(function(http) {
    var oCreateServer = http.createServer,
        oOutgoingMessageEnd = http.OutgoingMessage.prototype.end,
        oOutgoingMessageSendHeaderLines = http.OutgoingMessage.prototype.sendHeaderLines,
        oServerResponseWriteHead = http.ServerResponse.prototype.writeHead;
        
    http.createServer = function(requestListener) {
        var s = oCreateServer.apply(this, arguments);
        s._emit = s.emit;
        s.emit = function(type, req, res) {
            if (type === 'request' && s.elf) {
                var e = req.connection.elfEntry;
                for (var i in req.headers) {
                    e.fields['cs('+i+')'] = req.headers[i];
                }
                if (e.fields['cs(host)']) {
                    e.fields['cs-host'] = e.fields['cs(host)'];
                }
                extend(e.fields, {
                    'c-ip': req.connection.remoteAddress,
                    'cs-method': req.method,
                    'cs-uri': req.url,
                    'cs-version': req.httpVersion
                });
                var parsed = url.parse(req.url);
                if (parsed.pathname) {
                    e.fields['cs-uri-stem'] = parsed.pathname;
                }
                if (parsed.query) {
                    e.fields['cs-uri-query'] = parsed.query;
                }
                req.elfEntry = res.elfEntry = e;
            }
            return s._emit.apply(this, arguments);
        }
        return s;
    }
    
    http.OutgoingMessage.prototype.end = function() {
        var rtn = oOutgoingMessageEnd.apply(this, arguments);
        if (this.elfEntry) {
            var now = new Date();
            this.elfEntry.date = now;
            this.elfEntry.fields['date'] = formatDate(now);
            this.elfEntry.fields['time'] = formatTime(now);
            this.elfEntry.responseComplete = true;
            // Write the entry to interested log files
            this.elfEntry.log();
            // Create a new ElfEntry on the original 'Stream', for keep-alive connections
            this.connection.elfEntry = new ElfEntry(this.elfEntry.server);
        }
        return rtn;
    }
    
    http.OutgoingMessage.prototype.sendHeaderLines = function(firstLine, headers) {
        var rtn = oOutgoingMessageSendHeaderLines.apply(this, arguments);
        if (this.elfEntry) {
            for (var i in headers) {
                // Log all headers as lower case, since HTTP headers are case-insensitive
                this.elfEntry.fields[('sc('+i+')').toLowerCase()] = headers[i];
            }
        }
        return rtn;
    }
    
    http.ServerResponse.prototype.writeHead = function(statusCode) {
        var rtn = oServerResponseWriteHead.apply(this, arguments);
        if (this.elfEntry) {
            this.elfEntry.fields['sc-status'] = Number(statusCode);
        }
        return rtn;
    }

    // TODO eventually remove sendHeader(), writeHeader(), (when ry does)
    http.ServerResponse.prototype.sendHeader = http.ServerResponse.prototype.writeHead;
    http.ServerResponse.prototype.writeHeader = http.ServerResponse.prototype.writeHead;
        
    // We need to define this function while we're in the native 'http' scope
    isServer = function(server) {
        return server instanceof http.Server;
    }
})(require("http"));




// There is a single ElfServer instance attached to every http.Server
// instance. They keep a list of attached ElfLogger instances, as well as
// get the external IP if needed, and 
function ElfServer(httpServer) {
    var loggers = [];
    
    httpServer.addListener("connection", function(stream) {
        stream.elfEntry = new ElfEntry(httpServer.elf);
        var write = stream.write;
        stream.write = function(data, encoding) {
            var rtn = write.apply(this, arguments);
            this.elfEntry.fields['sc-bytes'] += data instanceof Buffer ?
                    data.length : Buffer.byteLength(data, encoding);
            return rtn;
        }
        stream.addListener("data", function(data) {
            // TODO: possibly determine the actual encoding of the String
            this.elfEntry.fields['cs-bytes'] += data instanceof Buffer ?
                    data.length : Buffer.byteLength(data, 'utf8');
        });
    });

    // Add an ElfLogger to the http.Server
    this.add = function(logger) {
        loggers.push(logger);
    }
    // Remove an ElfLogger from the http.Server
    this.remove = function(logger) {
        var index = loggers.indexOf(logger);
        if (index >= 0) {
            arrayRemove(loggers, index);
        }
    }
    this.forEach = function(iterator, thisObj) {
        return loggers.forEach(iterator, thisObj);
    }
    this.addServerFields = function(elfEntry) {
        elfEntry.server = this;
        var address = httpServer.address();
        extend(elfEntry.fields, {
            's-port': address.port,
            's-ip': address.address
        });
    }
}




// An ElfLogger instance represents a single logging configuration
// for an HttpServer. Instances are created through the `createLogger`
// function. Any number of ElfLoggers can be created for a single
// HttpServer instance.
function ElfLogger(httpServer, options) {
    if (!isServer(httpServer)) {
        throw new Error('"createLogger" expects an \'http.Server\' instance.');
    }
    
    var self = this, i=options.fields.length;
    extend(self, options);
    while (i--) {
        self.fields[i] = String(self.fields[i]).toLowerCase();
    }
    
    this.start = function() {
        if (!httpServer.elf) {
            httpServer.elf = new ElfServer(httpServer);
        }
        httpServer.elf.add(self);
    }
    this.stop = function() {
        httpServer.elf.remove(self);
    }
    
    this.start();
}

extend(ElfLogger.prototype, {
    // Any "fresh" WritableStream needs to have the header written
    // out to. This only happens once per Stream.
    writeHeader: function(stream) {
        var now = new Date(),
            header = "#Software: Node.js/"+process.version+"\n"+
                     "#Version: 1.0\n"+
                     "#Date: "+formatDate(now)+" "+formatTime(now)+"\n"+
                     "#Fields: ";
        for (var i=0; i<this.fields.length; i++) {
            header += this.fields[i] + (i < this.fields.length-1 ? ' ' : '\n');
        }    
        stream.write(header, 'utf8');
        stream._elfHeaderWritten = true;
    },
    // Accepts an ElfEntry instance and inspects its' collected
    // `fields` in order to determine the log that the entry
    // shoud be written to.
    getEntryFilename: function(entry) {
        var filename = typeof this.template === 'function' ?
            this.template(entry.fields) :
            evalTemplate(this.template, entry.fields);
        return filename && this.dir ? path.join(this.dir, filename) : filename;
    }
});




// An ElfEntry represents a single entry in a log file (or multiple
// log files). An ElfEntry instance is attached to HttpRequest and
// HttpResponse pairs during a 'request' event.
function ElfEntry(server) {
    this.fields = {};
    this.fields['sc-bytes'] = this.fields['cs-bytes'] = 0;
    server.addServerFields(this);
}

extend(ElfEntry.prototype, {
    // Once all `fields` have been collected, this function flushes
    // the Entry's contents out to the ElfLoggers the http.Server
    // has attached to it.
    log: function() {
        this.server.forEach(function(logger) {
            if (logger.stream) { // log directly to stream
                this.writeToStream(logger, logger.stream);
                
            } else { // go through the standard filename templating
                var logPath = logger.getEntryFilename(this);
                if (logPath)
                    writeToLog(logPath, this, logger);
            }
        }, this);
    },
    // Write's the ElfEntry's `fields` contents out to a
    // WritableStream. This will happen once per ElfLogger
    // instance attached to the server.
    writeToStream: function(logger, stream) {
        if (!stream._elfHeaderWritten) {
            logger.writeHeader(stream);
        }
        var line = "";
        for (var i=0; i<logger.fields.length; i++) {
            var val = this.fields[logger.fields[i]];
            line += val ? String(val) : '-';
            line += i < logger.fields.length-1 ? ' ' : '\n';
        }
        stream.write(line, 'utf8');        
    }
});




// ElfLog instances represent an individual log file that ElfEntry's
// get written to. The `filepath` for the ElfLog is determined by the
// ElfLogger instance's `template` property. The class acts as a wrapper
// around a WritableStream to the log file. The class will also create
// the log file, and any dependant directories (mkdir -p) if necessary.
function ElfLog(filepath, logger) {
    var self = this;
    this.logger = logger;
    this.ready = false;
    this.queuedEntries = [];
    this.logPath = filepath;
    
    var dirExists = true,
        logName = path.basename(filepath),
        dirs = getDirs(filepath);
    
    if (dirs.length > 0) {
        
        var dCount = 0, dirExists = true;
        var checkDir = function() {
                var subDirs = dirs.slice(0, dCount+1);
                subDirs = subDirs.length === 1 ?
                    (subDirs[0] || '/') :
                    path.join.apply(path, subDirs);

                if (dirExists) {
                    fs.stat(subDirs, function(err, stat) {
                        if (stat) {
                            dCount++;
                        } else {
                            // 'err' exists
                            dirExists = false;
                        }
                                    
                        if (dCount < dirs.length)
                            checkDir();
                        else
                            self.createWriteStream();
                    });
                } else {
                    fs.mkdir(subDirs, 0777, function(err) {
                        dCount++;
                        if (dCount < dirs.length)
                            checkDir();
                        else
                            self.createWriteStream();
                    });
                }
        }
        checkDir();
        
    } else {
        
        fs.stat(subDirs, function(err, stat) {
            if (stat) {
                // TODO perform check and DO NOT overwrite the existing log
                self.createWriteStream();
            } else {
                self.createWriteStream();
            }
        });
        
    }
}

extend(ElfLog.prototype, {
    // Gets called once all dependant directories positively exist.
    // The function will create the actual log file if one doesn't
    // exist, and obtain a WritableStream to the file.
    createWriteStream: function() {
        this.stream = fs.createWriteStream(this.logPath, {
            'flags': 'w',
            'encoding': 'utf8',
            'mode': 0666
        });
        this.ready = true;
        this.queuedEntries.forEach(function(entry) {
            this.writeEntry(entry);
        }, this);
    },
    // Called when an ElfEntry is ready to be written to the log.
    // If the underlying WritableStream is ready, then the log
    // entry will be written immediately, otherwise it's placed
    // in a queue that gets processed once the stream is ready.
    queueEntry: function(entry) {
        if (this.ready) {
            this.writeEntry(entry);
        } else {
            this.queuedEntries.push(entry);
        }
    },
    // Performs the writing of the ElfEntry to the underlying
    // stream. No "ready" checks are performed.
    writeEntry: function(entry) {
        entry.writeToStream(this.logger, this.stream);
    }
});

var elfLogs = {};

function writeToLog(filepath, entry, logger) {
    var elfLog;
    if (elfLogs[filepath]) {
        elfLog = elfLogs[filepath];
    } else {
        elfLog = elfLogs[filepath] = new ElfLog(filepath, logger);
    }
    elfLog.queueEntry(entry);
}











// Array Remove - By John Resig (MIT Licensed)
function arrayRemove(array, from, to) {
  var rest = array.slice((to || from) + 1 || array.length);
  array.length = from < 0 ? array.length + from : from;
  return array.push.apply(array, rest);
}

// Copies the properties from 'source' onto 'destination'
function extend(destination, source) {
    for (var property in source)
        destination[property] = source[property];
    return destination;
}

function formatDate(date) {
    var year = date.getUTCFullYear(),
        month = date.getUTCMonth()+1,
        day = date.getUTCDate();
    return year + "-" + pad(month) + "-" + pad(day);
}

function formatTime(date) {
    var hours = date.getUTCHours(),
        mins = date.getUTCMinutes(),
        secs = date.getUTCSeconds(),
        tenths = Math.floor(date.getUTCMilliseconds()/100);
    return pad(hours) + ":" + pad(mins) + ":" + pad(secs) + "." + tenths;
}

function pad(num) {
    return num < 10 ? '0' + num : num;
}

function evalTemplate(template, user) {
    return template.replace(/{[^{}]+}/g, function(key){
        return user[key.replace(/[{}]+/g, "").toLowerCase()] || "-";
    });
}

function getDirs(logPath) {
    var dirs = [], p = String(logPath), r;
    // TODO: a prettier way to write this loop
    do {
        r = getRootDir(p);
        if (r) {
            p = p.substring(r.length+1);
            dirs.push(r);
        }
    } while (r != null);
    return logPath.indexOf('/') === 0 ? shiftLeadingSlash(dirs) : dirs;
}

function getRootDir(dirPath) {
    var root = null, p = path.join(dirPath, "..");
    while (p.length > 0) {
        root = p;
        p = path.join(p, "..");
    }
    return root;
}

function shiftLeadingSlash(array) {
    var rtn = [''], i=0, cur;
    for (var i=0; i<array.length; i++) {
        cur = array[i];
        if (i===0) {
            cur = cur.substring(1);
        }
        rtn.push(cur);
    }
    return rtn;
}
