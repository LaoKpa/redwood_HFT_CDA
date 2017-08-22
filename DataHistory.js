RedwoodHighFrequencyTrading.factory("DataHistory", function () {
   var api = {};

   api.createDataHistory = function (startTime, startFP, myId, group, debugMode, speedCost, startingWealth, maxSpread) {
      //Variables
      dataHistory = {};
      
      dataHistory.startTime = startTime;
      dataHistory.myId = myId;
      dataHistory.group = group;
      dataHistory.curFundPrice = [startTime, startFP, 0];
      dataHistory.pastFundPrices = [];
      dataHistory.transactions = [];    //entries look like [timestamp, myTransaction]
      dataHistory.profit = startingWealth;
      dataHistory.speedCost = speedCost;
      dataHistory.maxSpread = maxSpread;

      dataHistory.playerData = {};     //holds state, offer and profit data for each player in the group
      dataHistory.lowestSpread = "N/A";

      dataHistory.highestMarketPrice = startFP;
      dataHistory.lowestMarketPrice = startFP;
      dataHistory.highestProfitPrice = startingWealth;
      dataHistory.lowestProfitPrice = startingWealth;

      dataHistory.debugMode = debugMode;

      dataHistory.NoPatchYet = false;      //patch until darrell fixes upper and lower bound transactions

      dataHistory.totalMakers = 0;
      dataHistory.totalSnipers = 0;
      dataHistory.fastMakers = 0;
      dataHistory.fastSnipers = 0;
      dataHistory.totalTraders = 0;

      dataHistory.SnipeTransaction = false;
      dataHistory.SnipeStyle = "";
      dataHistory.snipeOP = 1;
      dataHistory.lastTime = null;

      dataHistory.receivedSpread = [];
      
      dataHistory.positive_sound;
      dataHistory.negative_sound;

      dataHistory.recvMessage = function (msg) {
         switch (msg.msgType) {
            case "FPC"      :
               this.recordFPCchange(msg);
               break;
            case "C_TRA"    :
               if(msg.subjectID > 0) {             //added 7/24/17 to stop sending redundant messages to be stored
                  this.storeTransaction(msg);
               }
               break;
            case "USPEED" :
               this.storeSpeedChange(msg);
               break;
            case "C_UBUY"   :
            case "C_EBUY"   :
               this.recordBuyOffer(msg);
               break;
            case "C_USELL"  :
            case "C_ESELL"  :
               this.recordSellOffer(msg);
               break;
            case "C_RBUY"   :
               this.storeBuyOffer(msg.timeStamp, msg.subjectID);
               break;
            case "C_RSELL"  :
               this.storeBuyOffer(msg.timeStamp, msg.subjectID);
               break;
            case "UMAKER" :
               this.recordStateChange("Maker", msg.msgData[0], msg.msgData[1]); //rs.user_id, $scope.tradingGraph.getCurOffsetTime()]
               break;
            case "USNIPE" :
               this.recordStateChange("Snipe", msg.msgData[0], msg.msgData[1]);
               break;
            case "UOUT" :
               this.recordStateChange("Out", msg.msgData[0], msg.msgData[1]);
               break;
            case "UUSPR" :
               this.playerData[msg.msgData[0]].spread = msg.msgData[1];
               this.calcLowestSpread();
               break;
         }
      };

      // Functions
      
      //initializes player data storage
      dataHistory.init = function () {
         dataHistory.positive_sound = new Audio("/static/experiments/redwood-high-frequency-trading-remote/Sounds/coin.ogg");
         dataHistory.positive_sound.volume = .02;
         dataHistory.negative_sound = new Audio("/static/experiments/redwood-high-frequency-trading-remote/Sounds/negative-beep.wav");
         dataHistory.negative_sound.volume = .1;
         for (var uid of this.group) {
            this.playerData[uid] = {
               speed: false,
               curBuyOffer: null,
               curSellOffer: null,
               pastBuyOffers: [],
               pastSellOffers: [],
               state: "Out",
               spread: this.maxSpread / 2,
               curProfitSegment: [this.startTime, this.profit, 0, "Out"], // [start time, start profit, slope, state]
               pastProfitSegments: [],                              // [start time, end time, start price, end price, state]
               profitJumps: []
            };
         }
      };

      dataHistory.getCurrBuy = function () {    //function for updating start.html fields
         if(this.playerData[this.myId].state == "Maker"){
            return this.playerData[this.myId].curBuyOffer == null ? "N/A" : this.playerData[this.myId].curBuyOffer[1];
         }
         else{
            return "N/A";
         }
      };

      dataHistory.getCurrSell = function () {
         if(this.playerData[this.myId].state == "Maker"){
            return this.playerData[this.myId].curSellOffer == null ? "N/A" : this.playerData[this.myId].curSellOffer[1];
         }
         else{
            return "N/A";
         }
      };

      dataHistory.calcLowestSpread = function () {
         this.lowestSpread = "N/A";
         for (var player in this.playerData) {
            if (this.playerData[player].state == "Maker" && (this.lowestSpread == "N/A" || this.playerData[player].spread < this.lowestSpread)) {
               this.lowestSpread = this.playerData[player].spread;
            }
         }
      };

      dataHistory.recordStateChange = function (newState, uid, timestamp) {
         this.playerData[uid].state = newState;
         this.calcLowestSpread();

         var curProfit = this.playerData[uid].curProfitSegment[1] - ((timestamp - this.playerData[uid].curProfitSegment[0]) * this.playerData[uid].curProfitSegment[2] / 1000000000);
         this.recordProfitSegment(curProfit, timestamp, this.playerData[uid].curProfitSegment[2], uid, newState, true);

         if(newState != "Maker"){                           //added 8/9/17 to remove any orders that dont get shifted
            this.playerData[uid].curBuyOffer = null;
            this.playerData[uid].curSellOffer = null;
         }
      };

      // Adds fundamental price change to history
      dataHistory.recordFPCchange = function (fpcMsg) {
         if (fpcMsg.msgData[1] > this.highestMarketPrice) this.highestMarketPrice = fpcMsg.msgData[1];
         if (fpcMsg.msgData[1] < this.lowestMarketPrice) this.lowestMarketPrice = fpcMsg.msgData[1];

         //console.log(printTime(getTime()) + " Player: " + this.myId + " in DataHistory price change\n");
         this.storeFundPrice(fpcMsg.msgData[0]);
         this.curFundPrice = [fpcMsg.msgData[0], fpcMsg.msgData[1], 0];
      };

      dataHistory.storeFundPrice = function (endTime) {
         this.pastFundPrices.push([this.curFundPrice[0], endTime, this.curFundPrice[1]]);
         this.curFundPrice = null;
      };

      //records a new buy offer
      dataHistory.recordBuyOffer = function (buyMsg) {
         if(buyMsg.subjectID > 0){
            if(this.playerData[buyMsg.subjectID].state == 'Snipe'){                                   //TEST -> don't want to graph snipe offer
               // console.log("Tried to record buy offer, state: "  + this.playerData[buyMsg.subjectID].state);
               return;
            }
            //Check if current buy offer needs to be stored
            if (this.playerData[buyMsg.subjectID].curBuyOffer != null) {
               this.storeBuyOffer(buyMsg.timeStamp, buyMsg.subjectID);
            }
            //Push on new buy offer
            this.playerData[buyMsg.subjectID].curBuyOffer = [buyMsg.timeStamp, buyMsg.price];   // [timestamp, price]

            this.receivedSpread[buyMsg.subjectID] = this.playerData[buyMsg.subjectID].spread;         //added 8/22 because normal spread is processed too quickly

            // check to see if new buy price is lowest price so far
            if (buyMsg.price < this.lowestMarketPrice) this.lowestMarketPrice = buyMsg.price;
         }
      };

      // Records a new Sell offer
      dataHistory.recordSellOffer = function (sellMsg) {
         if(sellMsg.subjectID > 0){                            //TEST 7/20/17 
            if(this.playerData[sellMsg.subjectID].state == 'Snipe'){                                 //TEST -> don't want to graph snipe offer
               // console.log("Tried to record sell offer, state: "  + this.playerData[sellMsg.subjectID].state);
               return;
            }
            //Check if current sell offer needs to be stored
            if (this.playerData[sellMsg.subjectID].curSellOffer != null) {
               this.storeSellOffer(sellMsg.timeStamp, sellMsg.subjectID);
            }
            //Push on new sell offer
            this.playerData[sellMsg.subjectID].curSellOffer = [sellMsg.timeStamp, sellMsg.price];   // [timestamp, price]

            this.receivedSpread[sellMsg.subjectID] = this.playerData[sellMsg.subjectID].spread;                 //added 8/22 because normal spread is processed too quickly

            // check to see if new sell price is highest price so far
            if (sellMsg.price > this.highestMarketPrice) this.highestMarketPrice = sellMsg.price;
         }
      };

      // Shifts buy offer from currently being active into the history
      dataHistory.storeBuyOffer = function (endTime, uid) {
         if (this.playerData[uid].curBuyOffer == null) {
            throw "Cannot shift " + uid + "'s buy offer because it is null";
         }
         this.playerData[uid].pastBuyOffers.push([this.playerData[uid].curBuyOffer[0], endTime, this.playerData[uid].curBuyOffer[1]]);  // [startTimestamp, endTimestamp, price]
         this.playerData[uid].curBuyOffer = null;
      };

      // Shifts sell offer from currently being active into the history
      dataHistory.storeSellOffer = function (endTime, uid) {
         if (this.playerData[uid].curSellOffer == null) {
            throw "Cannot shift " + uid + "'s sell offer because it is null";
         }
         this.playerData[uid].pastSellOffers.push([this.playerData[uid].curSellOffer[0], endTime, this.playerData[uid].curSellOffer[1]]);  // [startTimestamp, endTimestamp, price]
         this.playerData[uid].curSellOffer = null;
      };


      dataHistory.storeTransaction = function (msg) {
         var p;
         if (msg.buyerID == this.myId) {                                            // if I'm the buyer
            if(this.playerData[this.myId].state === "Snipe"){                       //set variables for flash
               // p = msg.price - msg.FPC;                                             //profit calculated opposite for snipers
               p = msg.FPC - msg.price;
               this.SnipeTransaction = true;
               this.SnipeStyle = p < 0 ? "snipe-loss" : "snipe-profit";
               this.snipeOP = .5;
            }
            else{
               p = msg.FPC - msg.price;
            }

            this.profit += p;

            if(p > 0){
               dataHistory.negative_sound.pause();
               dataHistory.positive_sound.play();
            }
            else{
               dataHistory.positive_sound.pause();
               dataHistory.negative_sound.play();
            }
         }
         else if (msg.sellerID == this.myId) {                                      //if I'm the seller
            if(this.playerData[this.myId].state === "Snipe"){                       //set variables for flash
               // p = msg.FPC - msg.price;                                             //profit calculated opposite for snipers
               p = msg.price - msg.FPC;  
               this.SnipeTransaction = true;
               this.SnipeStyle = p < 0 ? "snipe-loss" : "snipe-profit";
               this.snipeOP = .5;
            }
            else{
               p = msg.price - msg.FPC;                                             //Im a maker
            }
            this.profit += p;

            if(p > 0){
               dataHistory.negative_sound.pause();
               dataHistory.positive_sound.play();
            }
            else{
               dataHistory.positive_sound.pause();
               dataHistory.negative_sound.play();
            }
         }

         

         if (msg.buyerID != 0) {
            var uid = msg.buyerID;
            if (this.playerData[uid].curBuyOffer !== null) this.storeBuyOffer(msg.timeStamp, uid);
            //p = this.playerData[uid].state === "Snipe" ? msg.price - msg.FPC : msg.FPC - msg.price;     //snipe message profit calculated opposite of makers
            p = msg.FPC - msg.price;
            var curProfit = this.playerData[uid].curProfitSegment[1] - ((msg.timeStamp - this.playerData[uid].curProfitSegment[0]) * this.playerData[uid].curProfitSegment[2] / 1000000000); //changed from 1000
            // console.log(this.playerData[uid].state, "buy for profit:", p);
            this.recordProfitSegment(curProfit + p, msg.timeStamp, this.playerData[uid].curProfitSegment[2], uid, this.playerData[uid].state, false, curProfit);
         }
         if (msg.sellerID != 0) {
            var uid = msg.sellerID;
            if (this.playerData[uid].curSellOffer !== null) this.storeSellOffer(msg.timeStamp, uid);
            // p = this.playerData[uid].state === "Snipe" ? msg.FPC - msg.price : msg.price - msg.FPC;     //snipe message profit calculated opposite of makers
            p = msg.price - msg.FPC;
            var curProfit = this.playerData[uid].curProfitSegment[1] - ((msg.timeStamp - this.playerData[uid].curProfitSegment[0]) * this.playerData[uid].curProfitSegment[2] / 1000000000); //changed from 1000
            // console.log(this.playerData[uid].state, "sell for profit:", p);
            this.recordProfitSegment(curProfit + p, msg.timeStamp, this.playerData[uid].curProfitSegment[2], uid, this.playerData[uid].state, false, curProfit);
         }

         if(msg.subjectID > 0){                                               //ADDED 7/21/17 to fix transaction horizontal lines
            this.transactions[0] = msg;                                       //added 7/24/17 -> we only need to graph the most recent transaction
         }
         
      };

      dataHistory.storeSpeedChange = function (msg) { //("USER", "USPEED", [rs.user_id, $scope.using_speed, $scope.tradingGraph.getCurOffsetTime()])
         var uid = msg.msgData[0];
         this.playerData[uid].speed = msg.msgData[1];
         var curProfit = this.playerData[uid].curProfitSegment[1] - ((msg.msgData[2] - this.playerData[uid].curProfitSegment[0]) * this.playerData[uid].curProfitSegment[2] / 1000000000); //changed from 1000
         this.recordProfitSegment(curProfit, msg.msgData[2], msg.msgData[1] ? this.speedCost : 0, uid, this.playerData[uid].state, true);
      };

      dataHistory.recordProfitSegment = function (price, startTime, slope, uid, state, speedChange, old) {
         if (price > this.highestProfitPrice) this.highestProfitPrice = price;
         if (price < this.lowestProfitPrice) this.lowestProfitPrice = price;

         if (this.playerData[uid].curProfitSegment != null) {
            if(speedChange){  //dont draw a profit line when changing speed or state
               this.playerData[uid].profitJumps.push({timestamp: startTime, newPrice: 0, oldPrice: 0});
            } 
            else {
               this.playerData[uid].profitJumps.push({timestamp: startTime, newPrice: price, oldPrice: old});
            }
            this.lastTime = startTime;
            this.storeProfitSegment(startTime, uid);
         }
         this.playerData[uid].curProfitSegment = [startTime, price, slope, state];
         //console.log("player: " + uid + " state: " + state + " price:" + price + " \n");
      };

      dataHistory.storeProfitSegment = function (endTime, uid) {
         if (this.playerData[uid].curProfitSegment == null) {
            throw "Cannot store current profit segment because it is null";
         }
         //find end price by subtracting how far graph has descended from start price
         var endPrice = this.playerData[uid].curProfitSegment[1] - ((endTime - this.playerData[uid].curProfitSegment[0]) * this.playerData[uid].curProfitSegment[2] / 1000000000); //changed from 1000
         this.playerData[uid].pastProfitSegments.push([this.playerData[uid].curProfitSegment[0], endTime, this.playerData[uid].curProfitSegment[1], endPrice, this.playerData[uid].curProfitSegment[3]]);
         // console.log(this.playerData[uid].curProfitSegment[1], endPrice);
         this.playerData[uid].curProfitSegment = null;
      };

      dataHistory.CalculatePlayerInfo = function() {        //calculates info on players for UI
         dataHistory.totalMakers = 0;
         dataHistory.totalSnipers = 0;
         dataHistory.fastMakers = 0;
         dataHistory.fastSnipers = 0;
         dataHistory.totalTraders = 0;
         for (var uid of this.group){
            if(this.playerData[uid].state === "Maker"){
               dataHistory.totalMakers++;
               dataHistory.totalTraders++;
               // console.log(dataHistory.totalMakers, "totalMakers");
               if(this.playerData[uid].speed == true){
                  dataHistory.fastMakers++;
               }
            }
            if(this.playerData[uid].state === "Snipe"){
               dataHistory.totalSnipers++;
               dataHistory.totalTraders++;
               // console.log(dataHistory.totalSnipers, "totalSnipers");
               if(this.playerData[uid].speed == true){
                  dataHistory.fastSnipers++;
               }
            }
         }
         // console.log("makers:",dataHistory.totalMakers,"snipers:",dataHistory.totalSnipers,"total:",dataHistory.totalTraders);
      };

      return dataHistory;
   };

   return api;
});
