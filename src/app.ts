import { Address, createServer, Host, Packet, Peer} from "enet";
import { GameClient, IResponseObject, ServerData } from "./entities";
import { RequestMessageType, VisibilityLevelType } from "./enums";
import { CreateLobbyHandler, JoinLobbyHandler, LeaveLobbyHandler, ListLobbiesHandler, LoginHandler, MapListHandler, RequestCharacterDataHandler } from "./message-handlers";
import { MesssageHandlerBase } from "./message-handlers/message-handler-base.handler";
import { GameUtilities } from "./utilities";

export class App {

    public serverData: ServerData = new ServerData();
    public gameServer: Host;

    private addr = new Address("0.0.0.0", 9521);
    private peerCount: number = 32;
    private channelCount: number = 2;
    private downLimit: number = 0;
    private upLimit: number = 0;
    private loopIntervalMs: number = 50;
    private maintenanceIntervalHandleId: number;
    private maintenanceIntervalPeriod: number = 1000;
    private clientInactivityThresholdMs: number = 60000;

    public start(): void {
        console.log("Starting server...");

        this.gameServer = createServer({
            address: this.addr,
            peers: this.peerCount,
            channels: this.channelCount,
            down: this.downLimit,
            up: this.upLimit
        }, (err: any, host: Host) => {
            if (err) {
                return;
            }

            host.on("connect", (peer: Peer, data: any) => {

                console.log(`Peer ${peer._pointer} connected`);

                const newClient: GameClient = new GameClient();
                newClient.clientId = peer._pointer;
                newClient.peerRef = peer;
                newClient.lastActivity = GameUtilities.getUtcTimestamp();
                newClient.authenticationHash = null;

                this.serverData.clients.push(newClient);

                peer.on("message", (packet: Packet, channel: number) => {
                    const clientId = peer._pointer;
                    const client = this.serverData.getUser(clientId);

                    // TODO: send back some nasty message saying they need to reconnect because they've been dropped for inactivity
                    if (!client) {
                        return;
                    }

                    client.lastActivity = GameUtilities.getUtcTimestamp();
                    const gameObject = JSON.parse(packet.data().toString());

                    console.log(`Got packet from ${client.clientId} with message_type of ${gameObject.message_type}`);

                    const messageType = gameObject.message_type;

                    let messageHandler: MesssageHandlerBase = null;

                    // anonymous handlers (login)
                    if (messageType === RequestMessageType.Login) {
                        messageHandler = new LoginHandler(gameObject, client, this.serverData);
                    } else {
                        // non anonymous handlers - check auth hash
                        // TODO: make sure hash matches
                        if (client.authenticationHash) {
                            switch (messageType) {
                                case RequestMessageType.Pong:
                                    // basically just do nothing other than update the activity time
                                    return;
                                case RequestMessageType.RequestMapList:
                                    messageHandler = new MapListHandler(gameObject, client, this.serverData);
                                    break;
                                case RequestMessageType.RequestCharacterData:
                                    messageHandler = new RequestCharacterDataHandler(gameObject, client, this.serverData);
                                    break;
                                case RequestMessageType.ListLobbies:
                                    messageHandler = new ListLobbiesHandler(gameObject, client, this.serverData);
                                    break;
                                case RequestMessageType.CreateLobby:
                                    messageHandler = new CreateLobbyHandler(gameObject, client, this.serverData);
                                    break;
                                case RequestMessageType.JoinLobby:
                                    messageHandler = new JoinLobbyHandler(gameObject, client, this.serverData);
                                    break;
                                case RequestMessageType.LeaveLobby:
                                    messageHandler = new LeaveLobbyHandler(gameObject, client, this.serverData);
                                    break;
                                default:
                                    // TODO: bad message handler
                                    break;
                            }
                        }
                    }

                    if (messageHandler !== null) {
                        const responseObjectsPromise: Promise<IResponseObject[]> = messageHandler.handleMessage();

                        responseObjectsPromise.then((responseObjects: IResponseObject[]) => {
                            if (responseObjects) {
                                for (const responseObject of responseObjects) {
                                    if (!responseObject) {
                                        continue;
                                    }

                                    if (responseObject.visibility === VisibilityLevelType.Room) {
                                        for (const lobby of this.serverData.lobbies) {

                                            if (lobby.id === client.lobbyId) {
                                                for (const player of lobby.players) {
                                                    const user = this.serverData.getUser(player.clientId);
                                                    this.sendResponse(user.peerRef, responseObject, user);
                                                }
                                                break;
                                            }
                                        }
                                    } else if (responseObject.visibility === VisibilityLevelType.Private) {
                                        this.sendResponse(peer, responseObject, client);
                                    }
                                }
                            }
                        }, (rejectionReason) => {
                            // do something with an error here
                        });
                    }
                });
            });

            host.start(this.loopIntervalMs);
            console.info("Server ready on %s:%s", host.address().address, host.address().port);
        });

        this.maintenanceIntervalHandleId = setInterval(() => {
            this.runMaintenence();
        }, this.maintenanceIntervalPeriod) as any;
    }

    public stop(): void {
        if (this.maintenanceIntervalHandleId) {
            clearInterval(this.maintenanceIntervalHandleId);
        }

        this.gameServer.stop();
    }

    private runMaintenence(): void {
        let i = this.serverData.clients.length;
        const currentTime = GameUtilities.getUtcTimestamp();

        const prunedClientIds: string[] = [];

        while (i--) {
            if (!this.serverData.clients[i] || currentTime - this.serverData.clients[i].lastActivity >= this.clientInactivityThresholdMs) {
                prunedClientIds.push(this.serverData.clients[i].clientId);
                this.serverData.clients.splice(i, 1);
            }
        }

        let j = this.serverData.lobbies.length;

        while (j--) {
            let k = this.serverData.lobbies[j].players.length;
            let shouldReorderSlots: boolean = false;

            while (k--) {
                if (prunedClientIds.indexOf(this.serverData.lobbies[j].players[k].clientId) > -1) {
                    this.serverData.lobbies[j].players.splice(k, 1);
                    shouldReorderSlots = true;
                }
            }

            // no players left in this lobby, remove the lobby
            if (this.serverData.lobbies[j].players.length === 0) {
                this.serverData.lobbies.splice(j, 1);
            } else if (shouldReorderSlots) {
                // at least one player removed from the lobby, reorder slots
                // TODO: put this code somehwere more generic
                for (let l = 0; l < this.serverData.lobbies[j].players.length; l++) {
                    this.serverData.lobbies[j].players[l].slot = (l + 1);
                }
            }
        }
    }

    private sendResponse(peer: Peer, data: IResponseObject, client: GameClient): void {
        const jsonResponse = JSON.stringify(data);
        let clientId = "";

        if (client && client.clientId) {
            clientId = client.clientId;
        }

        peer.send(0, jsonResponse, (err: any) => {
            if (err) {
                console.log("Error sending packet");
            } else {
                console.log(`Message sent successfully to ${clientId}`);
            }
        });
    }
}