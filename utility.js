// return the number of nanoseconds since midnight
function getTime(){
   var m = moment.tz("America/Los_Angeles"); 
   var hours =   m.hours()       *(60*60)*1000000000;
   var minutes = m.minutes()     *60*1000000000;
   var seconds = m.seconds()     *1000000000;
   var millis  = m.milliseconds()*1000000;
   return hours+minutes+seconds+millis;
}

function printTime(nanoseconds){
  var str = "";
  var millis  = Math.floor((nanoseconds / 1000000) % 1000);
  var seconds = Math.floor((nanoseconds / 1000000000) % 60);
  var minutes = Math.floor(nanoseconds / (60*1000000000) % 60);
  var hours   = Math.floor(nanoseconds / (60*60*1000000000) % 24);
  str = "[" + hours + ":" + minutes + ":" + seconds + ":" + millis + "]";
  return str;
}



// Message object. Used to communicate between group manager, subject manager, and market algorithm
function Message(protocol, msgType, msgData) {
   this.protocol = protocol;
   this.delay = false;
   this.msgType = msgType;
   this.msgData = msgData;
   this.timeStamp = getTime();
   
   // formats message as string for debugging
   this.asString = function(){
      var s = '';
      //var s = msgType + " timestamp:" + printTime(this.timeStamp) + " subjID:" + msgData[0];
      if(msgType == "C_EBUY" || msgType == "C_ESELL" || msgType == "C_UBUY" || msgType == "C_USELL"){
        s += msgType + " timestamp:" + printTime(this.timeStamp) + " buyer/sellerID: " + msgData[0] + " price: " + msgData[1] + " time-order-entered: " + printTime(msgData[2]);
      }
      else if(msgType == "UBUY" || msgType == "USELL"){
        s +=  msgType + " timestamp:" + printTime(this.timeStamp) + " buyer/sellerID:" + this.prevMsgId + "->" + this.msgId + " price: " + msgData[1];
      }
      else if (msgType == "C_TRA"){
        s += msgType + " timestamp:" + printTime(this.timeStamp) + " buyerID:" + msgData[1] + " sellerID: " + msgData[2] + " price: " + msgData[3];
      }
      else if(msgType == "EBUY" || msgType == "ESELL"){
        s += msgType + " timestamp:" + printTime(this.timeStamp) + " buyer/sellerID:" + msgData[0] + " price:" + msgData[1] + " IOC: " + msgData[2] + " msgID: " + this.msgId;
      }
      else{
        s += msgType + " timestamp:" + printTime(this.timeStamp) + " subjID:" + msgData[0] + " msgID:" + this.msgId;
      }
      return s;
   }
   this.senderId;
   this.msgId;
   this.prevMsgId;
   this.numShares = 0;
}

// Updates timestamp of message to current timestamp
function updateMsgTime(msg) {
   msg.timeStamp = getTime();
}

// Returns packed message with "actionTime" tag used to simulate latency
function packMsg(msg, delay) {
   msg.delay = delay;
   return {
      "actionTime": msg.timeStamp + msg.delay,
      "msg": msg
   };
}

// OBSOLETE SINCE WE MOVED TO NEW TIMESTAMP SYSTEM
// Converts timestamp to readable time
function millisToTime(millis) {
   var date = new Date(millis);
   var str = '';
   str += date.getUTCHours() + "h:";
   str += date.getUTCMinutes() + "m:";
   str += date.getUTCSeconds() + "s:";
   str += date.getUTCMilliseconds() + "millis";
   return str;
}

// Logger object used to debug messages as they are recieved and sent
function MessageLogger(name, nameColor, elementId) {
   this.name = name;
   this.nameColor = nameColor;
   this.element = $("#" + elementId);

   this.logSend = function (msg, reciever) {
      this.element.append('<div class="log-line"><span style="color:'
         + this.nameColor + '"> ' + this.name
         + '</span> <span>sent message to ' + reciever + ' at</span> <span class="timestamp">'
         + millisToTime(msg.timeStamp) + '</span> <span> containing:</span> <span class="message">'
         + msg.msgType + '</span></div>');
      this.scrollDown();
   };

   this.logRecv = function (msg, sender) {
      this.element.append('<div class="log-line"><span style="color:'
         + this.nameColor + '"> ' + this.name
         + '</span> <span>recieved message from ' + sender + ' at </span> <span class="timestamp">'
         + millisToTime(msg.timeStamp) + '</span> <span> containing:</span> <span class="message">'
         + msg.msgType + '</span></div>');
      this.scrollDown();
   };

   this.logSendWait = function (msg) {
      this.element.append('<div class="log-line"><span style="color:'
         + this.nameColor + '"> ' + this.name
         + '</span> <span>out wait list at</span> <span class="timestamp">'
         + millisToTime(msg.timeStamp) + '</span> <span> delay</span> <span class="delay">'
         + String(msg.delay) + '</span> <span> containing:</span> <span class="message">'
         + msg.msgType + '</span></div>');
      this.scrollDown();
   };

   this.logRecvWait = function (msg) {
      this.element.append('<div class="log-line"><span style="color:'
         + this.nameColor + '"> ' + this.name
         + '</span> <span>in wait list at</span> <span class="timestamp">'
         + millisToTime(msg.timeStamp) + '</span> <span> delay</span> <span class="delay">'
         + String(msg.delay) + '</span> <span> containing:</span> <span class="message">'
         + msg.msgType + '</span></div>');
      this.scrollDown();
   };

   this.logString = function (str) {
      this.element.append('<div class="log-line"><span style="color:'
         + this.nameColor + '"> ' + this.name
         + '</span> <span>' + str + '</span></div>');
      this.scrollDown();
   };

   this.scrollDown = function () {
      this.element.scrollTop(this.element[0].scrollHeight);
   };
}

// array for synchronizing events. Initialize with an array holding all of the keys, then
// mark each key ready one at a time using markReady. All keys are marked when allReady returns true.
function SynchronizeArray(key_array) {
   this.readyFlags = {};
   this.readyCount = 0;
   this.targetReadyCount = key_array.length;
   for (var key of key_array) {
      this.readyFlags[key] = false;
   }
   this.markReady = function (key) {
      if (this.readyFlags[key] === undefined) {
         console.error("did not find element with key: " + String(key) + " in synchronizing array.");
         return;
      }
      if (!this.readyFlags[key]) {
         this.readyCount++;
         this.readyFlags[key] = true;
      }
   };
   this.allReady = function () {
      return this.readyCount === this.targetReadyCount;
   };
}

function getTimeToString(){
   byteArrayToString(intToByteArray(getTime()));
}

// simple exchange server that always accepts enter buy/sell cancels, and replaces. Will generate simple crosses
function DebugMarket(sendFunction){

   var LOG_MSGS = true;
   console.log("Setting up DebugMarket...");

   this.recvMessage = function(msgArr){

      var msg = "";
      for(num of msgArr){
         msg += String.fromCharCode(num);
      }
      
      if(LOG_MSGS){
         console.log("Debug Market recieved: " + msg);
      }

      // Enter order message
      if(msg.charAt(0) === "O"){
         console.log("order");
         var testAccept   = "A" + getTimeToString() + msg.subString(1, 15) + "LEEPS   \0\0\1\001\0\001"+String.fromCharCode(134)+String.fromCharCode(159)+"SUBF";
      }
   }

   this.sendMessage = function(msg){
      sendFunction(msg);
   }

}

// allows user to download string into file on local computer
function download(strData, strFileName, strMimeType) {

    var D = document,
        A = arguments,
        a = D.createElement("a"),
        d = A[0],
        n = A[1],
        t = A[2] || "text/plain";

    //build download link:
    a.href = "data:" + strMimeType + "charset=utf-8," + escape(strData);


    if (window.MSBlobBuilder) { // IE10
        var bb = new MSBlobBuilder();
        bb.append(strData);
        return navigator.msSaveBlob(bb, strFileName);
    } /* end if(window.MSBlobBuilder) */



    if ('download' in a) { //FF20, CH19
        a.setAttribute("download", n);
        a.innerHTML = "downloading...";
        D.body.appendChild(a);
        setTimeout(function() {
            var e = D.createEvent("MouseEvents");
            e.initMouseEvent("click", true, false, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
            a.dispatchEvent(e);
            D.body.removeChild(a);
        }, 66);
        return true;
    }; /* end if('download' in a) */



    //do iframe dataURL download: (older W3)
    var f = D.createElement("iframe");
    D.body.appendChild(f);
    f.src = "data:" + (A[2] ? A[2] : "application/octet-stream") + (window.btoa ? ";base64" : "") + "," + (window.btoa ? window.btoa : escape)(strData);
    setTimeout(function() {
        D.body.removeChild(f);
    }, 333);
    return true;
}