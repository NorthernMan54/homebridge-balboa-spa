import * as net from "net";
import * as crc from "crc";


export class SpaTestClient {
    socket?: net.Socket;
    lightIsOn: (boolean | undefined)[];
    // takes values from 0 to pumpsSpeedRange[thisPump]
    pumpsCurrentSpeed: number[];
    // 0 means doesn't exist, else 1 or 2 indicates number of speeds for this pump
    pumpsSpeedRange: number[];

    // undefined if not on the spa, else 0-3
    blowerCurrentSpeed: (number | undefined);
    // 0 means doesn't exist, else 1-3 indicates number of speeds for the blower
    blowerSpeedRange: number;

    // undefined means the aux doesn't exist on the spa
    auxIsOn: (boolean | undefined)[];

    // undefined means the mister doesn't exist on the spa
    misterIsOn: (boolean | undefined);

    // Is Spa set to operate in FAHRENHEIT or CELSIUS
    temp_CorF: string;

    // If temp_CorF is FAHRENHEIT, temperatures are all stored as degrees F, integers 
    // (so the resolution is 1 degree F).
    // If temp_CorF is CELSIUS, temperatures are all stored as 2x degrees C, integers 
    // (so the resolution is 0.5 degrees C).
    currentTemp?: number;
    // When spa is in 'high' mode, what is the target temperature
    targetTempModeHigh?: number;
    // When spa is in 'low' mode, what is the target temperature
    targetTempModeLow?: number;
    // Is spa in low or high mode.
    tempRangeIsHigh: boolean;
    // Time of day, based on the last message we've received, according to the Spa 
    // (sync it with the Balboa mobile app if you wish)
    hour: number;
    minute: number;
    // ready, ready at rest, etc.
    heatingMode: string;
    priming: boolean;
    time_12or24: string;
    isHeatingNow: boolean;
    hasCirculationPump: boolean;
    circulationPumpIsOn: boolean;
    filtering: number;
    lockTheSettings: boolean;
    lockTheEntirePanel: boolean;
    hold: boolean;
    receivedStateUpdate: boolean;
    autoSetSpaClock: boolean = true;

    // Takes values from FLOW_STATES
    flow: string;
    // Once the Spa has told us what accessories it really has. Only need to do this once.
    accurateConfigReadFromSpa: boolean;
    // Should be true for almost all of the time, but occasionally the Spa's connection drops
    // and we must reconnect.
    private isCurrentlyConnectedToSpa: boolean;
    numberOfConnectionsSoFar: number = 0;
    liveSinceDate: Date;
    // Stored so that we can cancel intervals if needed
    faultCheckIntervalId: any;
    stateUpdateCheckIntervalId: any;
    // Can be set in the overall config to provide more detailed logging
    devMode: boolean;

    lastStateBytes = new Uint8Array();
    lastFaultBytes = new Uint8Array();

    temperatureHistory: (number | undefined)[] = new Array();

    constructor(public readonly host: string,
        //    public readonly spaConfigurationKnownCallback: () => void, 
        //    public readonly changesCallback: () => void, 
        //    public readonly reconnectedCallback: () => void,
        devMode?: boolean) {
        this.accurateConfigReadFromSpa = false;
        this.isCurrentlyConnectedToSpa = false;
        this.devMode = (devMode ? devMode : false);
        // Be generous to start. Once we've read the config we will reduce the number of lights
        // if needed.
        this.lightIsOn = [false, false];
        this.auxIsOn = [false, false];
        this.misterIsOn = false;
        // Be generous to start.  Once we've read the config, we'll set reduce
        // the number of pumps and their number of speeds correctly
        this.pumpsCurrentSpeed = [0, 0, 0, 0, 0, 0];
        this.pumpsSpeedRange = [2, 2, 2, 2, 2, 2];
        this.blowerCurrentSpeed = 0;
        this.blowerSpeedRange = 0;
        // All of these will be set by the Spa as soon as we get the first status update
        this.currentTemp = undefined;
        this.hour = 12;
        this.minute = 0;
        this.heatingMode = "";
        this.temp_CorF = "";
        this.tempRangeIsHigh = true;
        this.targetTempModeLow = undefined;
        this.targetTempModeHigh = undefined;
        this.priming = false;
        this.time_12or24 = "12 Hr";
        this.isHeatingNow = false;
        this.hasCirculationPump = false;
        this.circulationPumpIsOn = false;
        this.filtering = 0;
        this.lockTheSettings = false;
        this.lockTheEntirePanel = false;
        this.hold = false;
        this.receivedStateUpdate = true;
        // This isn't updated as frequently as the above
        this.flow = 'AWAITING';
        this.liveSinceDate = new Date();
        // Our communications channel with the spa
        this.socket = this.get_socket(host);
        // Record temperature history - every 30 minutes
        //  setInterval(() => {
        //      this.recordTemperatureHistory();
        //  }, 30 * 60 * 1000);
    }


    get_socket(host: string) {
        if (this.isCurrentlyConnectedToSpa) {
            console.log("Already connected, should not be trying again.");
        }

        console.log("Connecting to Spa at", host, "on port 4257");
        this.socket = net.connect({
            port: 4257,
            host: host
        }, () => {
            this.numberOfConnectionsSoFar++;
            this.liveSinceDate.getUTCDay
            const diff = Math.abs(this.liveSinceDate.getTime() - new Date().getTime());
            const diffDays = Math.ceil(diff / (1000 * 3600 * 24));
            console.log('Successfully connected to Spa at', host,
                'on port 4257. This is connection number', this.numberOfConnectionsSoFar,
                'in', diffDays, 'days');
            this.successfullyConnectedToSpa();
        });
        this.socket?.on('end', () => {
            console.log("SpaClient: disconnected:");
        });
        // If we get an error, then retry
        this.socket?.on('error', (error: any) => {
            console.log(error);
            console.log("Had error - closing old socket, retrying in 20s");

            //    this.shutdownSpaConnection();
            //    this.reconnect(host);
        });

        return this.socket;
    }

    successfullyConnectedToSpa() {
        this.isCurrentlyConnectedToSpa = true;
        // Reset our knowledge of the state, since it will
        // almost certainly be out of date.
        //    this.resetRecentState();

        // Update homekit right away, and then again once some data comes in.
        // this.changesCallback();

        // listen for new messages from the spa. These can be replies to messages
        // We have sent, or can be the standard sending of status that the spa
        // seems to do every second.
        this.socket?.on('data', (data: any) => {
            const bufView = new Uint8Array(data);
            this.readAndActOnSocketContents(bufView);
            //   console.log("Received data from Spa: ", bufView);
        });

        // No need to do this once we already have all the config information once.
        if (!this.accurateConfigReadFromSpa) {
            // Get the Spa's primary configuration of accessories right away
            //    this.sendControlTypesRequest();

            // Some testing things. Not yet sure of their use.
            // Note: must use 'let' here so id is bound separately each time.
            for (let id = 0; id < 4; id++) {
                //        setTimeout(() => {
                //            this.sendControlPanelRequest(id);
                //        }, 1000 * (id + 1));
            }
            //    setTimeout(() => {
            //        this.send_config_request();
            //    }, 15000);
        }

        // Wait 5 seconds after startup to send a request to check for any faults
        /*
        setTimeout(() => {
            if (this.isCurrentlyConnectedToSpa) {
                this.send_request_for_faults_log();
            }
            if (this.faultCheckIntervalId) {
                console.log("Shouldn't ever already have a fault check interval running here.");
            }
            // And then request again once every 10 minutes.
            this.faultCheckIntervalId = setInterval(() => {
                if (this.isCurrentlyConnectedToSpa) {
                    this.send_request_for_faults_log();
                }
            }, 10 * 60 * 1000);
        }, 5000);
        */
        /*
                // Every 15 minutes, make sure we update the log. And if we haven't
                // received a state update, then message the spa so it starts sending
                // us messages again.
                if (this.stateUpdateCheckIntervalId) {
                    console.log("Shouldn't ever already have a state update check interval running here.");
                }
                this.stateUpdateCheckIntervalId = setInterval(() => {
                    if (this.isCurrentlyConnectedToSpa) {
                        this.checkWeHaveReceivedStateUpdate();
                    }
                }, 15 * 60 * 1000)
        
                // Call to ensure we catch up on anything that happened while we
                // were disconnected.
                this.reconnectedCallback();
                */
    }

    lastIncompleteChunk: (Uint8Array | undefined) = undefined;
    lastChunkTimestamp: (Date | undefined) = undefined;

    readAndActOnSocketContents(chunk: Uint8Array) {
        // If we have a lastIncompleteChunk, then it may be the new chunk is just what is needed to
        // complete that.
        if (this.lastIncompleteChunk) {
            const diff = Math.abs(this.lastChunkTimestamp!.getTime() - new Date().getTime());
            if (diff < 1000) {
                // Merge the messages, if timestamp difference less than 1 second
                chunk = this.concat(this.lastIncompleteChunk, chunk);
                console.log("Merging messages of length", this.lastIncompleteChunk.length, "and", chunk.length);
            } else {
                console.log("Discarding old, incomplete message", this.prettify(this.lastIncompleteChunk));
            }
            this.lastIncompleteChunk = undefined;
            this.lastChunkTimestamp = undefined;
        }

        let messagesProcessed = 0;

        while (chunk.length > 0) {
            if (chunk.length < 2) {
                console.log("Very short message received (ignored)", this.prettify(chunk));
                break;
            }
            // Length is the length of the message, which excludes the checksum and 0x7e end.
            const msgLength = chunk[1];

            if (msgLength > (chunk.length - 2)) {
                // Cache this because more contents is coming in the next packet, hopefully
                this.lastIncompleteChunk = chunk;
                this.lastChunkTimestamp = new Date();
                console.log("Incomplete message received (awaiting more data)", this.prettify(chunk),
                    "missing", (msgLength - chunk.length + 2), "bytes");
                break;
            }
            // We appear to have a full message, perhaps more than one.
            if (chunk[0] == 0x7e && chunk[msgLength + 1] == 0x7e) {
                // All spa messages start and end with 0x7e
                if (msgLength > 0) {
                    const thisMsg = chunk.slice(0, msgLength + 2);
                    const checksum = thisMsg[msgLength];
                    // Seems like a good message. Check the checksum is ok
                    if (checksum != this.compute_checksum(new Uint8Array([msgLength]), thisMsg.slice(2, msgLength))) {
                        console.log("Bad checksum", checksum, "for", this.prettify(thisMsg));
                    } else {
                        /*
                        const somethingChanged = this.readAndActOnMessage(msgLength, checksum, thisMsg);
                        if (somethingChanged) {
                            // Only log state when something has changed.
                            console.log("State change:", this.stateToString());
                            // Call whoever has registered with us - this is our homekit platform plugin
                            // which will arrange to go through each accessory and check if the state of
                            // it has changed. There are 3 cases here to be aware of:
                            // 1) The user adjusted something in Home and therefore this callback is completely
                            // unnecessary, since Home is already aware.
                            // 2) The user adjusted something in Home, but that change could not actually take
                            // effect - for example the user tried to turn off the primary filter pump during
                            // a filtration cycle, and the Spa will ignore such a change.  In this case this
                            // callback is essential for the Home app to reflect reality
                            // 3) The user adjusted something using the physical spa controls (or the Balboa app),
                            // and again this callback is essential for Home to be in sync with those changes.
                            //
                            // Theoretically we could be cleverer and not call this for the unnecessary cases, but
                            // that seems like a lot of complex work for little benefit.  Also theoretically we
                            // could specify just the controls that have changed, and hence reduce the amount of
                            // activity.  But again little genuine benefit really from that, versus the code complexity
                            // it would require.
                            this.changesCallback();
                        }
                            */
                    }
                } else {
                    // Message length zero means there is no content at all. Not sure if this ever happens,
                    // but no harm in just ignoring it.
                }
                messagesProcessed++;
            } else {
                // Message didn't start/end correctly
                console.log("Message with bad terminations encountered:", this.prettify(chunk));
            }
            // Process rest of the chunk, as needed (go round the while loop).
            // It might contain more messages
            chunk = chunk.slice(msgLength + 2);
        }
        return messagesProcessed;
    }

    compute_checksum(length: Uint8Array, bytes: Uint8Array) {
        const checksum = crc.crc8(Buffer.from(this.concat(length, bytes)), 0x02);
        return checksum ^ 0x02;
    }

    concat(a: Uint8Array, b: Uint8Array) {
        const c = new Uint8Array(a.length + b.length);
        c.set(a);
        c.set(b, a.length);
        return c;
    }

    prettify(message: Uint8Array) {
        return Buffer.from(message).toString('hex').match(/.{1,2}/g);
    }
}