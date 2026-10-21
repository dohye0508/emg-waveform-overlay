/**
 * This file creates the JS Canvas Copter game
 *
 * Based on the original flash copter game:
 * http://www.seethru.co.uk/zine/south_coast/helicopter_game.htm
 *
 */

var jsCopter = {

    // object : default options, can be overwritten by init call
    options : {
        canvas : {
            width : 500,
            height : 300,
            refreshRate : 20
        },
        copter : {
            width : 30,
            height : 15,
            topSpeed : 5,                   // max speed
            acceleration : 0.15,            // how much to increase the speed by each time the game refreshes and the button is held down
            img : null                      // optional copter image path, relative to the html page
        },
        physics : {
            terminalVelocity : 4,           // max speed
            gravity : 0.5,
            friction : 0.8
        },
        walls : {
            separation : 19,                //fudge
            width : 20,
            step : 5,                       // potential height difference for each new wall
            startHeight : 60,
            maxHeight : 120,
            heightIncreaseInterval : 5,     // how often to increase the height of each wall (from start to max)
            heightIncreaseStep : 10         // how much to increase the height of each wall by
        },
        obstacles : {
            separation : 250,               // frequency of obstacles
            width : 20,
            height : 50
        },
        colours : {
            bg : "#000000",
            fill : "#ff9900",
            light : "#ffffff"
        }
    },

    // object : the game elements
    gameData : {
        copter : {
            x : 20,
            y : 0,
            speed : 0,
            rotation : 0
        },
        walls : {
            counter : 0,
            currentHeight : 0,
            currentStep : 0,
            heightIncreaseInterval : 0,    // fudge
            current : [],
            ids : 0                         // EMG Overlay: stable id per wall for decorations
        },
        distance : 0,                       // EMG Overlay: how far the cave has scrolled
        crashedAt : 0,                      // EMG Overlay: time of the last crash (ms)
        crashY : 0,
        obstacles : {
            counter : 0,
            current : []
        }
    },

    // object : scores - ints and html objects
    scores : {
        current : 0,
        top : 0,
        elements : {
            current : null,
            top : null
        },
        halfStep : 0    // fudge
    },

    // object: the html canvas area
    canvas : null,

    // object : the html parent element containing the canvas
    container : null,

    // object : the interval between pie fills
    canvasInterval : null,

    // object : the canvas draw context
    drawContext : null,

    // bool : is the mouse button currently being held down?
    mouseDown : false,

    // bool : is the game currently running?
    gameRunning : false,

    // object : to contain the death text. when you die.
    deathText : null,


    /**
     * start the JS Copter process
     *
     * @param canvasId string the id of the canvas element that will be created
      * @param parentId string the id of the html element to attach the canvas to
     * @param options object a set of optional options, to set defaults
     *
     * @return void
     */
    init: function(canvasId, parentId, options){

        // search for parent element - if not found, stop now
        this.container = document.getElementById(parentId);
        if (!this.container) return false;

        // set the options
        for (var optionType in options) {
            for (var subOption in options[optionType]) {
                this.options[optionType][subOption] = options[optionType][subOption];
            }
        };

        // Create a canvas element
        this.canvas = this.createCanvas(canvasId);

        // Set up the scoring
        this.initScoring();

        // create draw context
        this.drawContext = this.canvas.getContext("2d");

        // Create initial BG content for the canvas
        this.createBG();

        // set the intial copter game data
        this.resetGameData();

        // create copter element
        this.createCopter();

        // create initial floor & ceiling
        this.createInitialWalls();

        // set a mouse listener to start the game
        this.initMouseListener();
    },


    /*
     * create a canvas element of specific size
     *
     * @param id string the id of the canvas element that will be created
     *
     * @return canvas object the created canvas
      */
    createCanvas: function(canvasId) {

        // create the canvas (EMG Overlay: drawn by art.js at the window's size and pixel ratio)
        var canvas = document.createElement("canvas");
        canvas.id = canvasId;

        // add the canvas into the page
        this.container.appendChild(canvas);

        return canvas;
    },


    /*
     * create initial border and fill of canvas element
     *
     */
    createBG: function() {

        // EMG Overlay: the background is drawn by art.js
    },


    /*
     * Reset game data
     */
    resetGameData: function() {

        // reset current score
        this.scores.current = this.scores.elements.current.innerHTML = 0;

        // reset 'y' position of copter
        this.gameData.copter.y = Math.round(this.options.canvas.height/2);
        this.gameData.copter.x = this.options.copter.startX || 20;   // EMG Overlay
        this.gameData.copter.speed = 0;
        this.gameData.copter.rotation = 0;
        this.gameData.stars = [];                                       // EMG Overlay: stars to collect
        this.gameData.starsCollected = 0;

        // reset the starting height of the walls
        this.gameData.walls.currentHeight = this.options.walls.startHeight;

        // reset the steps between wall heights
        this.gameData.walls.currentStep = this.options.walls.step;

        // set first obstacle to start straight away
        this.gameData.obstacles.counter = this.options.obstacles.separation - this.options.obstacles.width;

        // remove all obstacles
        this.gameData.obstacles.current.length = 0;

        // remove all walls
        this.gameData.walls.current.length = 0;

        this.gameData.distance = 0;
        this.gameData.crashedAt = 0;

        // create initial floor and ceiling
        this.createInitialWalls();
    },


    /*
     * create initial copter element
     * @param draw object the canvas draw context
     */
    createCopter: function() {

        // get the global draw context
        var draw = this.drawContext;

        // EMG Overlay: smoother physics than the original. The original set the fall speed straight to a constant
        // ((speed + gravity) * friction settles in a few frames), which looked unnatural. Here gravity and thrust are
        // added every frame with a little air drag, so the copter speeds up and slows down gradually,
        // and the nose follows the vertical speed instead of turning at a fixed rate.
        var c = this.gameData.copter;
        var acc = this.options.physics.gravity - (this.mouseDown === true ? this.options.copter.acceleration : 0);
        c.speed = (c.speed + acc) * this.options.physics.friction;
        if (c.speed > this.options.physics.terminalVelocity) c.speed = this.options.physics.terminalVelocity;
        if (c.speed < -this.options.copter.topSpeed) c.speed = -this.options.copter.topSpeed;
        var targetRot = Math.max(-0.3, Math.min(0.35, c.speed * 0.045));
        c.rotation += (targetRot - c.rotation) * 0.18;

        // set new Y position
        this.gameData.copter.y = this.gameData.copter.y + this.gameData.copter.speed;
        return; // EMG Overlay: the copter is drawn by art.js

        // create and position copter element
        draw.save();
        draw.translate(this.gameData.copter.x, this.gameData.copter.y);
        draw.rotate(this.gameData.copter.rotation);

        // condition : if an image is specified, use it
        if (this.options.copter.img) {

            // save 'this' context
            var that = this;

            // create copter element
            var copter = new Image();
            copter.src = that.options.copter.img;

            // when image has loaded
            copter.onload = function() {
                draw.drawImage(copter, that.gameData.copter.x, that.gameData.copter.y, copter.width, copter.height);
                that.options.copter.width = copter.width;
                that.options.copter.height = copter.height;
            }

        // no image set, use a block
        } else {
            draw.beginPath();
            this.roundedRect(draw, 0, 0, this.options.copter.width, this.options.copter.height, 10);
            draw.fillStyle = this.options.colours.light;
            draw.fill();
        }

        draw.restore();
    },


    /*
     * Create a rounded rectangle
     * From: https://developer.mozilla.org/samples/canvas-tutorial/2_7_canvas_combined.html
     *
     */
    roundedRect: function(draw, x, y, width, height, radius) {
        draw.beginPath();
        draw.moveTo(x,y+radius);
        draw.lineTo(x,y+height-radius);
        draw.quadraticCurveTo(x,y+height,x+radius,y+height);
        draw.lineTo(x+width-radius,y+height);
        draw.quadraticCurveTo(x+width,y+height,x+width,y+height-radius);
        draw.lineTo(x+width,y+radius);
        draw.quadraticCurveTo(x+width,y,x+width-radius,y);
        draw.lineTo(x+radius,y);
        draw.quadraticCurveTo(x,y,x,y+radius);
        //draw.stroke();
    },


    /**
     * Initialise the scoring
     *
     */
    initScoring: function() {

        // EMG Overlay: scores are drawn by art.js, so these only hold the numbers;
        // the top score is kept in localStorage instead of a cookie
        this.scores.elements.current = {};
        this.scores.elements.top = {};
        var cookie = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } } };

        // retrieve the current top score from cookie, if cookie script is present
        if (!!cookie && !!cookie.get) {
            var topScore = cookie.get('planeBest');
        }

        // condition : if a current top score exists, set it
        if (topScore) {
            this.scores.top = this.scores.elements.top.innerHTML = topScore;
        }
    },


    /**
     * create score html elements
     *
     */
    createScore: function(scoreType) {

        // create score element
        var scoreContainer = document.createElement("p");
        scoreContainer.id = scoreType+"scorecontainer";
        var scoreContainerText = document.createTextNode(this.ucFirst(scoreType) + " score: ");
        scoreContainer.appendChild(scoreContainerText);

        // create score container, ready to return
        var score = document.createElement("strong");
        score.id = scoreType+"score";

        // set the current score to 0
        var scoreText = document.createTextNode("0");
        score.appendChild(scoreText);
        scoreContainer.appendChild(score);

        // add the scores to the page
        this.container.appendChild(scoreContainer);

        return score;
    },


    /**
     * Initialise the mouse listener, to detect when the mouse button is being pressed
     */
    initMouseListener: function(){

        // save 'this' state
        var that = this;

        // EMG Overlay: any mouse button anywhere or any key (except Esc, which leaves the game) holds the copter up.
        // After a crash a new game starts only after 1.2 s, so a squeeze held while crashing does not restart at once.
        var press = function() {
            that.mouseDown = true;
            if (that.gameRunning === false && Date.now() - that.gameData.crashedAt > 1200) {
                that.startGame();
            }
        };
        var release = function() { that.mouseDown = false; };
        window.addEventListener('mousedown', function(e) { e.preventDefault(); press(); });
        window.addEventListener('mouseup', release);
        window.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') return;
            e.preventDefault();
            if (!e.repeat) press();
        });
        window.addEventListener('keyup', function(e) { if (e.key !== 'Escape') release(); });
        window.addEventListener('blur', release);
        window.addEventListener('contextmenu', function(e) { e.preventDefault(); });
    },


    /*
     * Start the game
     */
    startGame: function() {

        // reset game data
        this.resetGameData();

        // set running variable
        this.gameRunning = true;

        // set interval to start the game
        var that = this;
        this.canvasInterval = setInterval(function() { that.draw(); }, this.options.canvas.refreshRate);
    },


    /*
     * Draw the canvas element; function called repeatedly by interval
     *
     */
    draw: function() {

        // check for impact
        var impact = this.checkForImpact();

        // condition : check for an impact
        if (impact === false) {

            // update graphics
            this.createBG();
            this.createCopter();
            this.createWalls();
            this.createObstacles();

            // update score
            this.updateScore();
            this.gameData.distance += this.options.copter.topSpeed;

        // condition : an impact has occurred, end the game
        } else {
            this.endGame();
        }
    },


    /*
     * Check the current position of the copter, to see if it has hit something
     */
    checkForImpact: function() {

        // EMG Overlay: obstacles are rock spires (triangles) growing from the floor or the ceiling.
        // The copter box is tested at several points against each spire's triangle, so the narrow tip is fair.
        var c = this.gameData.copter;
        var cw = this.options.copter.width, ch = this.options.copter.height;
        var probe = [[0.15, 0.2], [0.85, 0.2], [0.15, 0.85], [0.85, 0.85], [0.5, 0.0], [0.5, 1.0], [1.0, 0.5], [0.0, 0.5]];
        for (var x = 0; x < this.gameData.obstacles.current.length; x++) {
            var o = this.gameData.obstacles.current[x];
            if (o.x > c.x + cw || o.x + o.w < c.x) continue;
            var t = this.spireTriangle(o);
            for (var i = 0; i < probe.length; i++) {
                if (this.pointInTriangle(c.x + probe[i][0] * cw, c.y + probe[i][1] * ch, t)) return true;
            }
        }

        // loop through walls that we need to do detection
        for (var i2 = 0; i2 < this.gameData.walls.current.length; i2++){

            if (this.gameData.walls.current[i2].x < this.options.walls.width + c.x + cw) {

                // condition : check for impacts on the walls that are in range
                if (
                    (
                        this.gameData.walls.current[0].width == (this.options.canvas.width + this.options.walls.width) || // first wall
                        this.gameData.walls.current[i2].x >=0 // all other walls
                    ) && (
                        c.y < this.gameData.walls.current[i2].height || //top
                        c.y > (this.options.canvas.height - ch - (this.gameData.walls.current[i2].y-this.gameData.walls.current[i2].height)) // bottom
                    )
                ) {
                    return true;
                }
            }
        }

        // condition : final impact check - if somehow the copter has gone off screen, above or below
        if (c.y < 0 || c.y > (this.options.canvas.height - ch)) {
            return true;
        }

        // no impact detected
        return false;
    },


    /*
     * EMG Overlay: the triangle of a spire, a little narrower than its picture
     */
    spireTriangle: function(o) {
        var inset = o.w * 0.12;
        if (o.up) {
            return [[o.x + inset, o.base], [o.x + o.w - inset, o.base], [o.x + o.w / 2, o.base - o.h]];
        }
        return [[o.x + inset, o.base], [o.x + o.w - inset, o.base], [o.x + o.w / 2, o.base + o.h]];
    },


    pointInTriangle: function(px, py, t) {
        var d = function(a, b, c) { return (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]); };
        var p = [px, py];
        var d1 = d(p, t[0], t[1]), d2 = d(p, t[1], t[2]), d3 = d(p, t[2], t[0]);
        var neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
        return !(neg && pos);
    },


    /*
     * create the initial floor and ceiling
     */
    createInitialWalls: function() {

        // get the global draw context
        var draw = this.drawContext;

        // generate values for the new wall
        var newwall = {
            x: 0,
            y: this.gameData.walls.currentHeight,
            width : this.options.canvas.width + this.options.walls.width,
            height : (this.gameData.walls.currentHeight/2)
        }

        // add wall to the array (EMG Overlay: drawn by art.js)
        newwall.id = ++this.gameData.walls.ids;
        this.gameData.walls.current.push(newwall);
    },


    /*
     * create the floor and ceiling
     */
    createWalls: function() {

        // get the global draw context
        var draw = this.drawContext;

        // condition : if the separation (between walls) has been reached, create a new wall
        if (this.gameData.walls.counter++ >= Math.floor(this.options.walls.separation/this.options.copter.topSpeed)) {

            // get previous wall height
            var previousHeight = this.gameData.walls.current[this.gameData.walls.current.length-1].height;

            // random decision, whether to increase or decrease the height (either 0 or 1)
            var plusMinus = Math.round(Math.random());

            // throw in the occasional bigger jump in wall positioning...
            var bigOne = Math.round(Math.random()*10);

            // set variable that will contain new height
            var newHeight;

            // condition : calculate the new height
            if (bigOne == 10) {
                newHeight = this.gameData.walls.currentHeight/2;
            } else if (plusMinus == 1) {
                newHeight = previousHeight + Math.floor(Math.random()*this.gameData.walls.currentStep);
            } else {
                newHeight = previousHeight - Math.floor(Math.random()*this.gameData.walls.currentStep);
            }

            // condition : stop the height going too...high
            if (newHeight > this.gameData.walls.currentHeight) {
                newHeight = this.gameData.walls.currentHeight - this.gameData.walls.currentStep;
            }

            // condition : stop the height going too...low
            if (newHeight < 0) {
                newHeight = this.gameData.walls.currentStep;
            }

            // generate values for the new wall
            var newwall = {
                x: this.options.canvas.width,
                y: this.gameData.walls.currentHeight,
                width: this.options.walls.width,
                height: newHeight
            }

            // add wall to the array
            newwall.id = ++this.gameData.walls.ids;
            this.gameData.walls.current.push(newwall);

            // reset wall separation counter
            this.gameData.walls.counter = 0;
        }

        // move every wall in the array (EMG Overlay: drawn by art.js)
        for (var i=0; i < this.gameData.walls.current.length; i++) {

            this.gameData.walls.current[i].x -= this.options.copter.topSpeed;

            // condition : if the last wall in the array has disappeared off screen, remove it
            if (this.gameData.walls.current[i].x <= - (2*this.gameData.walls.current[i].width)) {
                this.gameData.walls.current.splice(i, 1);
            }
        }
    },



    /*
     * Update the obstacles
     */
    createObstacles: function() {

        // EMG Overlay: rock spires from the floor or the ceiling (sometimes a pair), getting taller over time,
        // and a star in the open space now and then. Passing a spire scores 1, a star scores 3.
        var H = this.options.canvas.height;
        var ground = this.gameData.walls.currentHeight / 2;           // floor and ceiling thickness
        var speed = this.options.copter.topSpeed;
        var level = Math.min(1, this.gameData.distance / (speed * 50 * 60));   // 0 → 1 over about a minute

        if (this.gameData.obstacles.counter++ >= Math.floor(this.options.obstacles.separation / speed)) {
            var open = H - 2 * ground;
            var minH = open * (0.28 + 0.12 * level), maxH = open * (0.48 + 0.12 * level);
            var mk = function(up, h) {
                var w = h * (108 / 239);
                return { x: this.options.canvas.width + 10, w: w, h: h, up: up, base: up ? H - ground + 6 : ground - 6, passed: false };
            }.bind(this);
            var r = Math.random();
            if (r < 0.25 + 0.15 * level) {
                // a pair: leave a gap big enough to fly through
                var gap = open * (0.42 - 0.08 * level);
                var top = Math.random() * (open - gap - 60) + 30;
                this.gameData.obstacles.current.push(mk(false, top));
                this.gameData.obstacles.current.push(mk(true, open - gap - top));
            } else {
                this.gameData.obstacles.current.push(mk(Math.random() < 0.5, minH + Math.random() * (maxH - minH)));
            }
            if (Math.random() < 0.55) {
                this.gameData.stars.push({ x: this.options.canvas.width + this.options.obstacles.separation / 2, y: ground + 40 + Math.random() * (open - 80), got: false });
            }
            this.gameData.obstacles.counter = 0;
        }

        var c = this.gameData.copter;
        for (var i = this.gameData.obstacles.current.length - 1; i >= 0; i--) {
            var o = this.gameData.obstacles.current[i];
            o.x -= speed;
            if (!o.passed && o.x + o.w < c.x) {
                o.passed = true;
                // a pair counts once
                if (o.up || !this.gameData.obstacles.current.some(function(q) { return q !== o && q.up && Math.abs(q.x - o.x) < 1; })) {
                    this.scores.current += 1;
                }
            }
            if (o.x + o.w < -20) this.gameData.obstacles.current.splice(i, 1);
        }
        for (var j = this.gameData.stars.length - 1; j >= 0; j--) {
            var st = this.gameData.stars[j];
            st.x -= speed;
            var cx = c.x + this.options.copter.width / 2, cy = c.y + this.options.copter.height / 2;
            if (!st.got && Math.abs(st.x - cx) < 34 && Math.abs(st.y - cy) < 30) {
                st.got = true;
                st.gotAt = Date.now();
                this.gameData.starsCollected++;
                this.scores.current += 3;
            }
            if (st.x < -40) this.gameData.stars.splice(j, 1);
        }
    },


    /*
     * Update the score - every second time, to stop it increasing so quickly
     */
    updateScore: function() {
        // EMG Overlay: points come from passing spires and collecting stars (see createObstacles)
    },


    /*
     * Function to call when the game has come to an end
     */
    endGame: function() {

        // condition : if the current score is higher than the top score, set it
        if (this.scores.current > this.scores.top) {

            // set the top score
            this.scores.elements.top.innerHTML = this.scores.current;

            // EMG Overlay: keep the top score in localStorage
            this.scores.top = this.scores.current;
            try { localStorage.setItem('planeBest', String(this.scores.current)); } catch (e) {}
        }

        // EMG Overlay: art.js shows the crash
        this.gameData.crashedAt = Date.now();
        this.gameData.crashY = this.gameData.copter.y;

        // stop the interval
        clearInterval(this.canvasInterval);

        // set running variable
        this.gameRunning = false;
    },


    /**
     * function to Capitalise the First text Character of A string
     * @param {string} title the url of the new link
     * @returns {string} the new Text String
     */
    ucFirst: function(textString) {
        //return textString.substr(0,1).toUpperCase() + textString.substr(1,textString.length);
        return textString;
    }
}