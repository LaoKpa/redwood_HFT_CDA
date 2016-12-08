Redwood.factory("GroupManager", function () {
   var api = {};

   api.createGroupManager = function (groupArgs, sendFunction) {
      var groupManager = {};

      groupManager.marketFlag = groupArgs.mFlag; // LOCAL  = use local market (i.e. this.market)
                                                 // REMOTE = use remote market by making websockets connection
                                                 // DEBUG  = use debug market (i.e. this.debugMarket)

      groupManager.marketAlgorithms = {};   // reference to all market algorithms in this group, mapped by subject id ---> marketAlgorithms[subjectID]
      groupManager.market = {};             // reference to the market object for this group
      groupManager.dataStore = {};

      groupManager.priceChanges = groupArgs.priceChanges;         // array of all price changes that will occur
      groupManager.investorArrivals = groupArgs.investorArrivals; // array of all investor arrivals that will occur
      groupManager.priceIndex = 1;                                // index of last price index to occur. start at 1 because start FP is handled differently
      groupManager.investorIndex = 0;                             // index of last investor arrival to occur
      groupManager.intervalPromise = null;                        // promise for canceling interval when experiment ends

      groupManager.groupNumber = groupArgs.groupNumber;
      groupManager.memberIDs = groupArgs.memberIDs; // array that contains id number for each subject in this group
      groupManager.syncFpArray = [];                // buffer that holds onto messages until received msg from all subjects
      groupManager.delay = 500;                     // # of milliseconds that will be delayed by latency simulation

      groupManager.syncFPArray = new SynchronizeArray(groupManager.memberIDs);
      groupManager.FPMsgList = [];
      groupManager.curMsgId = 1;

      groupManager.isDebug = groupArgs.isDebug;     // indicates if message logger should be used
      groupManager.marketLog = "";                  // strig of market events, will be output to file

      // TESTING AREA ********************************************************************************
      var testMsgs = [];
      
      var nMsg = new Message("OUCH", "EBUY", [1, 9910, false, getTime()]);
      nMsg.senderId = 1;
      nMsg.msgId = 1;
      testMsgs.push(leepsMsgToOuch(nMsg));

      /*nMsg = new Message("OUCH", "ESELL", [2, 9800, false, getTime()]);
      nMsg.senderId = 2;
      nMsg.msgId = 38;
      testMsgs.push(leepsMsgToOuch(nMsg));

      nMsg = new Message("OUCH", "EBUY", [3, 10109.99, false, getTime()]);
      nMsg.senderId = 3;
      nMsg.msgId = 785135456;
      testMsgs.push(leepsMsgToOuch(nMsg));

      nMsg = new Message("OUCH", "RBUY", [1, getTime()]);
      nMsg.senderId = 1;
      nMsg.msgId = 1024;
      testMsgs.push(leepsMsgToOuch(nMsg));

      nMsg = new Message("OUCH", "RSELL", [2, getTime()]);
      nMsg.senderId = 2;
      nMsg.msgId = 38;
      testMsgs.push(leepsMsgToOuch(nMsg));*/

      //printByteArray(testMsgs[0], 49);
      //outputMsgs(testMsgs);

      /*var testAccept   = "A\0\0\0\0\0\0\1\001SUBF0000000016B\0\0\0\001LEEPS   \0\0\1\001\0\001"+String.fromCharCode(134)+String.fromCharCode(159)+"SUBF";
      var testCanceled = "C\0\0\0\0\0\0\1\001SUBF0000000012\0\0\000aU";
      var testReplaced = "U\0\0\0\0\0\0\1\001SUBB0000000003S\0\0\0000LEEPS   \0\0\000a\0\0\0\000SUBBiiiiiiiiiiiiiiiiiSUBB0000000002"
      console.log(ouchToLeepsMsg(testAccept));
      console.log(ouchToLeepsMsg(testCanceled));
      console.log(ouchToLeepsMsg(testReplaced));
*/
      // END TESTING AREA **********************************************************************

      // only open websockets connection if running in REMOTE mode
      if(groupManager.marketFlag === "REMOTE"/*ZACH, D/N MODIFY!*/){

         // open websocket with market
         groupManager.marketURI = "ws://54.213.222.175:8000/";
         groupManager.socket = new WebSocket(groupManager.marketURI, ['binary', 'base64']);
         groupManager.socket.onopen = function(event) {
            //groupManager.socket.send("Confirmed Opened Websocket connection");
         };

         // recieves messages from remote market
         groupManager.socket.onmessage = function(event) {
            
            // create reader to read "blob" object
            var reader = new FileReader();
            reader.addEventListener("loadend", function() {

               console.log("Recieved From Remote Market: ");

               // reader.result contains the raw ouch message as a DataBuffer, convert it to string
               var ouchStr = String.fromCharCode.apply(null, new Uint8Array(reader.result));
               logStringAsNums(ouchStr);

               // split the string in case messages are conjoined
               var ouchMsgArray = splitMessages(ouchStr);

               for(ouchMsg of ouchMsgArray){
                  // translate the message and pass it to the recieve function
                  groupManager.recvFromMarket(ouchToLeepsMsg(ouchMsg));
               }
            });
            reader.readAsArrayBuffer(event.data);
            //reader.readAsText(event.data, "ASCII");
         };
      }

      if(groupManager.marketFlag === "DEBUG"){
         
         // wrapper for debug market recieve function
         groupManager.recvFromDebugMarket = function(msg){

            console.log("Recieved From Debug Market: " + msg);
            console.log(ouchToLeepsMsg(msg));
            groupManager.recvFromMarket(ouchToLeepsMsg(msg));
         }

         // initialize debug market
         groupManager.debugMarket = new DebugMarket(groupManager.recvFromDebugMarket);
      }


      // wrapper for the redwood send function
      groupManager.rssend = function (key, value) {
         sendFunction(key, value, "admin", 1, this.groupNumber);
      };

      groupManager.sendToDataHistory = function (msg, uid) {
         this.rssend("To_Data_History_" + uid, msg);
      };

      groupManager.sendToAllDataHistories = function (msg) {
         //this.dataStore.storeMsg(msg);
         this.rssend("To_All_Data_Histories", msg);
      };

      // sends a message to all of the market algorithms in this group
      groupManager.sendToMarketAlgorithms = function (msg) {
         for (var memberID of this.memberIDs) {
            this.marketAlgorithms[memberID].recvFromGroupManager(msg);
         }
      };

      // receive a message from a single market algorithm in this group
      groupManager.recvFromMarketAlgorithm = function (msg) {

         // synchronized message in response to fundamental price change
         if (msg.protocol === "SYNC_FP") {
            //mark that this user sent msg
            this.syncFPArray.markReady(msg.msgData[0]);
            this.FPMsgList.push(msg);


            // check if every user has sent a response
            if (this.syncFPArray.allReady()) {
               // shuffle the order of messages sitting in the arrays
               var indexOrder = this.getRandomMsgOrder(this.FPMsgList.length);

               // store player order for debugging purposes
               var playerOrder = [];

               // send msgs in new shuffled order
               for (var index of indexOrder) {
                  playerOrder.push(this.FPMsgList[index].msgData[0]);
                  for (var rmsg of this.FPMsgList[index].msgData[2]) {
                     this.sendToMarket(rmsg);
                  }
               }
               
               this.dataStore.storePlayerOrder(msg.timeStamp, playerOrder);

               // reset arrays for the next fundamental price change
               this.FPMsgList = [];
               this.syncFPArray = new SynchronizeArray(this.memberIDs);
            }
         }

         // general message that needs to be passed on to marketManager
         if (msg.protocol === "OUCH") {
            groupManager.sendToMarket(msg);
         }
      };

      // TODO setup arg for routing
      // Function for sending messages, will route msg to remote or local market based on this.marketFLag
      groupManager.sendToMarket = function (leepsMsg) {
         //If no delay send msg now, otherwise send after delay
         if (leepsMsg.delay) {
            if(this.marketFlag === "LOCAL"){
               window.setTimeout(this.sendToLocalMarket.bind(this), this.delay, leepsMsg);
            }
            else if(this.marketFlag === "REMOTE"){
               window.setTimeout(this.sendToRemoteMarket.bind(this), this.delay, leepsMsg);
            }
            else if(this.marketFlag === "DEBUG"){
               window.setTimeout(this.sendToDebugMarket.bind(this), this.delay, leepsMsg);
            }
         }
         else {
            if(this.marketFlag === "LOCAL"){
               this.sendToLocalMarket(leepsMsg);
            }
            else if(this.marketFlag === "REMOTE"){
               this.sendToRemoteMarket(leepsMsg);
            }
            else if(this.marketFlag === "DEBUG"){
               this.sendToDebugMarket(leepsMsg);
            }
         }
      };

      groupManager.sendToLocalMarket = function(leepsMsg){
         console.log("sending to local market");
         this.market.recvMessage(leepsMsg);
      }

      groupManager.sendToRemoteMarket = function(leepsMsg){
         var msg = leepsMsgToOuch(leepsMsg);
         this.socket.send(msg);
      }

      groupManager.sendToDebugMarket = function(leepsMsg){
         var msg = leepsMsgToOuch(leepsMsg);
         this.debugMarket.recvMessage(msg);
      }

      // handles a message from the market
      groupManager.recvFromMarket = function (msg) {

         // add message to log
         this.marketLog += msg.asString + "\n";
         console.log(this.marketLog);

         if(msg.msgType === "C_TRA"){
            this.sendToMarketAlgorithms(msg);
         }
         else {
            this.marketAlgorithms[msg.msgData[0]].recvFromGroupManager(msg);
         }
      };

      // handles message from subject and passes it on to market algorithm
      groupManager.recvFromSubject = function (msg) {

         // if this is a user message, handle it and don't send it to market
         if (msg.protocol === "USER") {
            var subjectID = msg.msgData[0];
            this.marketAlgorithms[subjectID].recvFromGroupManager(msg);

            this.dataStore.storeMsg(msg);
            if (msg.msgType == "UMAKER") this.dataStore.storeSpreadChange(msg.msgData[1], this.marketAlgorithms[subjectID].spread, msg.msgData[0]);
         }
      };

      // creates an array from 0 to size-1 that are shuffled in random order
      groupManager.getRandomMsgOrder = function (size) {

         // init indices from 0 to size-1
         var indices = [];
         var rand;
         var temp;
         for (var i = 0; i < size; i++) {
            indices.push(i);
         }

         // shuffle
         for (i = size - 1; i > 0; i--) {
            rand = Math.floor(Math.random() * size);
            temp = indices[i];
            indices[i] = indices[rand];
            indices[rand] = temp;
         }
         return indices;
      };

      groupManager.sendNextPriceChange = function () {
         // if current price is -1, end the game
         if (this.priceChanges[this.priceIndex][1] == -1) {
            this.rssend("end_game", this.groupNumber);
            return;
         }

         var msg = new Message("ITCH", "FPC", [getTime(), this.priceChanges[this.priceIndex][1], this.priceIndex]);
         msg.delay = false;
         this.dataStore.storeMsg(msg);
         this.sendToMarketAlgorithms(msg);

         this.priceIndex++;

         if (this.priceIndex >= this.priceChanges.length) {
            console.log("reached end of price changes array");
            return;
         }

         window.setTimeout(this.sendNextPriceChange, (this.startTime + this.priceChanges[this.priceIndex][0] - getTime()) / 1000000);
      }.bind(groupManager);

      groupManager.sendNextInvestorArrival = function () {
         this.dataStore.investorArrivals.push([getTime - this.startTime, this.investorArrivals[this.investorIndex][1] == 1 ? "BUY" : "SELL"]);
         var msg2 = new Message("OUCH", this.investorArrivals[this.investorIndex][1] == 1 ? "EBUY" : "ESELL", [0, 214748.3647, true]);
         msg2.msgId = this.curMsgId;
         this.curMsgId ++;
         msg2.delay = false;
         this.sendToMarket(msg2);

         this.investorIndex++;

         if (this.investorIndex >= this.investorArrivals.length) {
            console.log("reached end of investors array");
            return;
         }

         window.setTimeout(this.sendNextInvestorArrival, (this.startTime + this.investorArrivals[this.investorIndex][0] - getTime()) / 1000000);
      }.bind(groupManager);

      groupManager.update = function () {
         //Looks for change in fundamental price and sends message if change is found
         if (this.priceIndex < this.priceChanges.length
            && getTime() > this.priceChanges[this.priceIndex][0] + this.startTime) {
            if (this.priceChanges[this.priceIndex][1] == -1) {
               this.dataStore.exportDataCsv();
               this.rssend("end_game", this.groupNumber);
            }
            else {
               var msg = new Message("ITCH", "FPC", [getTime(), this.priceChanges[this.priceIndex][1], this.priceIndex]);
               msg.delay = false;
               this.dataStore.storeMsg(msg);
               this.sendToMarketAlgorithms(msg);
               this.priceIndex++;
            }
         }

         //looks for investor arrivals and sends message if one has occurred
         if (this.investorIndex < this.investorArrivals.length
            && getTime() > this.investorArrivals[this.investorIndex][0] + this.startTime) {
            var msg2 = new Message("OUCH", this.investorArrivals[this.investorIndex][1] == 1 ? "EBUY" : "ESELL", [0, 214748.3647, true]);
            msg2.delay = false;
            this.sendToMarket(msg2);
            this.investorIndex++;
         }
      };

      return groupManager;
   };

   return api;
});
