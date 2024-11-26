import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { MongoClient, ServerApiVersion } from "mongodb";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import bodyParser from "body-parser";
import dotenv from "dotenv";

dotenv.config();

// middle ware
const app = express();
app.use(cors());
app.use(bodyParser.json()); // parse application/json
app.use(bodyParser.urlencoded({ extended: true })); // parse application/x-www-form-urlencoded

const uri =
  "mongodb+srv://eric:lamericlychee3@multiplayergame.p3sa2.mongodb.net/?retryWrites=true&w=majority&appName=MultiplayerGame";
const server = http.createServer(app);

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db;
async function connectToDB() {
  try {
    await client.connect();
    db = client.db("Game");
    console.log("Connected to MongoDB: Game");
  } catch (err) {
    console.log(err);
  }
}
connectToDB();

// login system
app.post("/signup", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.json({ comment: "please enter the correct infomation" });
    // check if existing email exist
    const existingUser = await db.collection("user_info").findOne({ email: email });
    if (existingUser) return res.json({ comment: "email already exist" });
    // create a encode password
    if (password.length < 8)
      return res.json({
        comment: "the password needs to be atleast 8 characters long",
      });
    const hashedPassword = await bcrypt.hash(password, 10);
    // insert a user
    const user = await db.collection("user_info").insertOne({
      username: username,
      email: email,
      password: hashedPassword,
    });
    res.json(user);
  } catch (err) {
    res.json(err);
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    // find user from database
    const user = await db.collection("user_info").findOne({ email: email });
    if (!user) return res.json({ comment: "No email exist" });
    // create access token and verify password
    const accessToken = jwt.sign(user.email, process.env.ACCESS_TOKEN_SECRET);
    await db.collection("user_info").replaceOne({ email: email }, { ...user, accessToken: accessToken });
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (passwordMatch) {
      return res.json({ assessToken: accessToken, ...user });
    } else {
      return res.json({ comment: "password is wrong" });
    }
  } catch (err) {
    res.json(err);
  }
});

app.post("/checkToken", (req, res) => {
  try {
    const { token } = req.body;

    const verify = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    verify && res.json({ email: verify });
  } catch (err) {
    res.json({ comment: "token has outdate" });
  }
});

const io = new Server(server, {
  path: "/ws/",
  transports: ["websocket"],
  // cors: {
  //   origin: "http://localhost:3000",
  //   methods: ["GET", "POST"],
  // },
});

const roomPlayers = {}; // 用於存儲房間內的玩家
const roomIdList = [];
const startedGameId = [];
const dayTimeChat = {};
const nightTimeChat = {};
const vampireNightTimeChat = {};
const deadPlayerChat = {};
const nightTimeAction = {};
const dayTimeAction = {};
const votes = {};

io.on("connection", (socket) => {
  console.log(socket.id);
  socket.on("testDeploy", (data) => {
    socket.emit("testBack", data);
  });
  // 當用戶加入房間
  // handle player and room
  socket.on("joinRoom", ({ roomId }) => {
    console.log(roomId);
    if (!roomIdList.includes(roomId)) roomIdList.push(roomId);
    console.log(roomIdList);
    if (!startedGameId.includes(roomId)) {
      socket.join(roomId);
      socket.emit("gameStarted", { gameJoin: true, roomId });
    } else {
      socket.emit("gameStarted", { gameJoin: false, roomId });
    }
  });

  socket.on("getPlayer", async ({ roomId, playerName, email }) => {
    if (!roomPlayers[roomId]) {
      roomPlayers[roomId] = [];
    }

    const checkExist = roomPlayers[roomId].map((x) => x[1] === email);

    if (!checkExist.includes(true)) {
      roomPlayers[roomId].push([playerName, email]);
    }

    const data = roomPlayers[roomId].map((x) => {
      return { name: x[0], id: x[1], alive: true };
    });

    io.to(roomId).emit("playerList", data);
  });

  socket.on("killThePlayer", ({ roomId, position }) => {
    io.to(roomId).emit("quitWhenGameStart", position);
  });

  socket.on("logOut", ({ roomId, email }) => {
    if (roomId !== undefined && email !== undefined) {
      roomPlayers[roomId] = roomPlayers[roomId]?.filter((x) => x[1] !== email);
    }

    const data = roomPlayers[roomId]?.map((x) => {
      return { name: x[0], id: x[1] };
    });

    if (data) io.to(roomId).emit("playerList", data);
  });

  // socket.emit() only to self
  // socket.broadcast.emit() only to everyone other than self
  // io.emit() to all people
  // handle game start
  socket.on("gameStart", ({ roomId, start }) => {
    startedGameId.push(roomId);
    io.to(roomId).emit("returnGameStart", start);
  });

  // handle role assign
  socket.on("allRoleAssign", ({ roomId, data }) => {
    io.to(roomId).emit("roleAssign", data);
  });

  // handle day night change

  socket.on("sendSetDay", ({ roomId, dayTime }) => {
    io.to(roomId).emit("sendAllSetDay", { dayTime });
  });

  // handle daytime
  socket.on("dayChat", ({ name, message, roomId, repeat }) => {
    socket.join(roomId);

    if (!dayTimeChat[roomId]) {
      dayTimeChat[roomId] = [];
    }

    if (message) {
      dayTimeChat[roomId].push({ name: name, message: message });
    }

    if (repeat && repeat === "no") {
      dayTimeChat[roomId].reduce((acc, current) => {
        const x = acc.find((item) => item.message === current.message);
        if (!x) {
          acc.push(current);
        }
        return acc;
      }, []);
    }

    io.to(roomId).emit("allDayChat", dayTimeChat[roomId]);
  });

  // handle day action
  socket.on("dayAction", ({ days, position, roomId, target, action }) => {
    socket.join(roomId);

    if (!dayTimeAction[roomId]) {
      dayTimeAction[roomId] = [];
    }

    dayTimeAction[roomId].push({
      owner: position,
      target: target,
      action: action,
    });

    dayTimeAction[roomId] = dayTimeAction[roomId].filter((obj) => obj.target !== null);

    dayTimeAction[roomId] = dayTimeAction[roomId].filter((obj) => obj.action !== undefined);

    io.to(roomId).emit("allDayAction", dayTimeAction[roomId]);
  });

  socket.on("resetDayAction", ({ roomId }) => {
    if (dayTimeAction[roomId]) {
      dayTimeAction[roomId] = [];
    }
  });

  socket.on("resetNightAction", ({ roomId }) => {
    if (nightTimeAction[roomId]) {
      nightTimeAction[roomId] = [];
    }
  });
  // handle night time witch chatroom
  socket.on("nightChat", ({ name, message, roomId }) => {
    socket.join(roomId);

    if (!nightTimeChat[roomId]) {
      nightTimeChat[roomId] = [];
    }

    if (message) {
      nightTimeChat[roomId].push({ name: name, message: message });
    }

    io.to(roomId).emit("allNightChat", nightTimeChat[roomId]);
  });
  // handle night time vampire chatroom
  socket.on("vampireNightChat", ({ name, message, roomId }) => {
    socket.join(roomId);

    if (!vampireNightTimeChat[roomId]) {
      vampireNightTimeChat[roomId] = [];
    }

    if (message) {
      vampireNightTimeChat[roomId].push({
        name: name,
        message: message,
      });
    }

    io.to(roomId).emit("allVampireNightChat", vampireNightTimeChat[roomId]);
  });
  //handle dead person chatroom
  socket.on("deadPlayerChat", ({ name, message, roomId }) => {
    socket.join(roomId);

    if (!deadPlayerChat[roomId]) {
      deadPlayerChat[roomId] = [];
    }

    if (message) {
      deadPlayerChat[roomId].push({
        name: name,
        message: message,
      });
    }

    io.to(roomId).emit("allDeadPlayerChat", deadPlayerChat[roomId]);
  });
  //handle vote
  socket.on("submitVote", ({ id, target, roomId }) => {
    if (!votes[roomId]) {
      votes[roomId] = {};
    }

    // think about when the key not exist first
    if (!votes[roomId][id]) votes[roomId][id] = target;

    // when the key exist replace the old value with new value
    if (votes[roomId][id]) {
      if (target !== null) {
        votes[roomId][id] = target;
      } else {
        votes[roomId][id] = null;
      }
    }

    io.to(roomId).emit("updateVotes", votes[roomId]);
  });

  //handle clear vote
  socket.on("clearVotes", (roomId) => {
    votes[roomId] = {};
  });

  //handle nightAction
  socket.on("nightAction", ({ nights, position, roomId, target, action, twistedTarget }) => {
    socket.join(roomId);

    if (!nightTimeAction[roomId]) {
      nightTimeAction[roomId] = [];
    }

    if (twistedTarget) {
      nightTimeAction[roomId].push({
        owner: position,
        target: target,
        action: action,
        twistedTarget: twistedTarget,
      });
    } else {
      nightTimeAction[roomId].push({
        owner: position,
        target: target,
        action: action,
      });
    }

    nightTimeAction[roomId] = nightTimeAction[roomId].filter((obj) => obj.target !== null);

    nightTimeAction[roomId] = nightTimeAction[roomId].filter((obj) => obj.action !== undefined);

    const sortedNightActions = nightTimeAction[roomId].sort((a, b) => {
      const order = {
        convert: 1,
        kill: 1,
        destiny: 1,
        vampireKill: 1,
        lookout: 2,
        scam: 2,
        remember: 2,
        detect: 3,
        protect: 4,
      };

      return order[a.action] - order[b.action];
    });

    io.to(roomId).emit("allNightAction", sortedNightActions);
  });

  socket.on("gameEnd", ({ gameEnd, gameEndMessage, roomId }) => {
    io.to(roomId).emit("gameEndAll", {
      gameEndAll: gameEnd,
      gameEndMessageAll: gameEndMessage,
    });
  });

  // 當用戶斷開連接
  socket.on("disconnect", async () => {
    // let currentId = "";
    // let currentName = "";
    // let names = "";
    // const data = roomIdList.map((roomId) => {
    //   return (roomPlayers[roomId] = roomPlayers[roomId].filter((player) => {
    //     if (player[1] === socket.id) {
    //       currentId = roomId;
    //       currentName = player[0];
    //     }
    //     return player[1] !== socket.id;
    //   }));
    // });
    // console.log(roomPlayers);
    // if (currentId) roomPlayers[currentId] = data.flat();
    // console.log(roomPlayers);
    // if (currentId) names = roomPlayers[currentId].map((x) => x[0]);
    // io.to(currentId).emit("playerList", names);
    // console.log(socket.id);
    // console.log("disconnect", roomPlayers);
    // console.log(`${socket.id} disconnect`);
  });
});

// other game

server.listen(process.env.PORT, () => {
  console.log(`SERVER IS RUNNING ON ${process.env.PORT}`);
});
