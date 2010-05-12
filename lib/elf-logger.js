var fs = require("fs"), url = require("url"), path = require("path"), sys = require("sys");

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
    return new ElfLogger(httpServer, options || exports.defaultOptions);
};



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
            if (type === 'request' && s._elfs && s._elfs.length > 0) {
                var e = new ElfEntry(s);
                for (var i in req.headers) {
                    e.fields['cs('+i+')'] = req.headers[i];
                }
                e.fields['c-ip'] = req.connection.remoteAddress;
                e.fields['cs-method'] = req.method;
                e.fields['cs-uri'] = req.url;
                var parsed = url.parse(req.url);
                if (parsed.pathname)
                    e.fields['cs-uri-stem'] = parsed.pathname;
                if (parsed.query)
                    e.fields['cs-uri-query'] = parsed.query;
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
            this.elfEntry.fields['date'] = formatDate(now);
            this.elfEntry.fields['time'] = formatTime(now);
            // Write the entry to interested log files
            this.elfEntry.log();
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
})(require("http"));










// An ElfLogger instance represents a single logging configuration
// for an HttpServer. Instances are created through the `createLogger`
// function. Any number of ElfLoggers can be created for a single
// HttpServer instance.
function ElfLogger(httpServer, options) {
    var self = this, i=options.fields.length;
    extend(self, options);
    while (i--) {
        self.fields[i] = String(self.fields[i]).toLowerCase();
    }
    
    this.start = function() {
        if (!httpServer._elfs) httpServer._elfs = [];
        httpServer._elfs.push(self);
    }
    this.stop = function() {
        var index = httpServer._elfs.indexOf(self);
        if (index>=0)
            arrayRemove(httpServer._elfs, index);
    }
    
    this.start();
}

// Any "fresh" WritableStream needs to have the header written
// out to. This only happens once per Stream.
extend(ElfLogger.prototype, {
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
    getEntryFilename: function(entry) {
        var filename = typeof this.template === 'function' ?
            this.template(entry.fields) :
            evalTemplate(this.template, entry.fields);
        return this.dir ? path.join(this.dir, filename) : filename;
    }
});











// An ElfEntry represents a single entry in a log file (or multiple
// log files). An ElfEntry instance is attached to HttpRequest and
// HttpResponse pairs during a 'request' event.
function ElfEntry(server) {
    this.server = server;
    this.fields = {};
}

extend(ElfEntry.prototype, {
    log: function() {
        this.server._elfs.forEach(function(logger) {
            if (logger.stream) { // log directly to stream
                this.writeToStream(logger, logger.stream);
                
            } else { // go through the standard filename templating
                var logPath = logger.getEntryFilename(this);
                //sys.puts(logPath);
                writeToLog(logPath, this, logger);
            }
        }, this);
    },
    writeToStream: function(logger, stream) {
        if (!stream._elfHeaderWritten) {
            logger.writeHeader(stream);
        }
        for (var i=0; i<logger.fields.length; i++) {
            var val = this.fields[logger.fields[i]];
            stream.write(val ? String(val) : '-', 'utf8');
            stream.write(i < logger.fields.length-1 ? ' ' : '\n', 'utf8');
        }
    }
});













function ElfLog(filepath, logger) {
    var self = this;
    this.logger = logger;
    this.ready = false;
    this.queuedEntries = [];
    this.logPath = filepath;
    
    var dirExists = true,
        logName = path.basename(filepath),
        dirs = getDirs(filepath);
    
    //sys.puts(JSON.stringify(dirs));
    //sys.puts(logName);
        
    if (dirs.length > 0) {
        var dCount = 0, dirExists = true;

        var checkDir = function() {
                var subDirs = dirs.slice(0, dCount+1);
                subDirs = subDirs.length === 1 && subDirs[0] === '' ?
                    '/' : subDirs.join('/');
                if (dirExists) {
                    //sys.puts('stat: ' + subDirs);
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
                    sys.puts('mkdir: ' + subDirs);
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
        this.createWriteStream();
    }
}

extend(ElfLog.prototype, {
    createWriteStream: function() {
        this.stream = fs.createWriteStream(this.logPath, {
            'flags': 'w',
            'encoding': 'utf8',
            'mode': 0666
        });
        this.ready = true;
        this.flushQueue();
    },
    flushQueue: function() {
        this.queuedEntries.forEach(function(entry) {
            this.writeEntry(entry);
        }, this);
    },
    queueEntry: function(entry) {
        if (this.ready) {
            this.writeEntry(entry);
        } else {
            this.queuedEntries.push(entry);
        }
    },
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
