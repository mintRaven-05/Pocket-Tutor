const dotenv=require("dotenv");
dotenv.config();
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const express=require("express");
const app=express();
const bodyParser=require("body-parser");
const cors=require("cors");
const bcryptjs = require("bcryptjs");
const multer = require("multer");
const axios=require("axios");
const fs = require('fs'); // File system module to handle file operations
const path = require('path'); // For handling and transforming file paths
const FormData = require('form-data');
const mongoose=require("mongoose");
const signup=require("./Schema/signUp");
const profile=require("./Schema/profile");
const chat=require("./Schema/chat_history");
const db_uri=process.env.DB_URI;
const port=process.env.PORT;

mongoose.connect(db_uri).then(()=>{console.log("MongoDB Connection successful")});

app.use(cors({
    origin:true,
    methods:["GET","POST","PUT","DELETE"],
    allowedHeaders: "*",
    credentials: true,
}));
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.send("Welcome to the home page");
});

app.post("/signup", async (req, res) => {
    const { username, password, confirmPassword, courses } = req.body;
    try {
      //if (password !== confirmPassword) {
      //  return res.status(400).send({ message: "Passwords are not matching" });
      //}
      const user = await signup.findOne({ username });
      if (user) {
        return res.status(401).json({ error: "User Already exists!!" });
      }
      const salt = await bcryptjs.genSalt(10);
      const hashedpassword = await bcryptjs.hash(password, salt);
      const sign = new signup({
        username,
        password: hashedpassword,
        courses
      });
      await sign.save();
      return res.status(201).json({ message: "User registered Successfully!!" });
    } catch {
      return res.status(500).json({ error: "Internal Server Error" });
    }
  });

  app.post("/login",async(req,res)=>{
    try{
      const {username,password}=req.body;
      const user=await signup.findOne({username});
      if(!user){
        return res.status(401).json({error:"Invalid username or password"});
      }
      const isMatch=await bcryptjs.compare(password,user.password);
      if(!isMatch){
        return res.status(401).json({error:"Invalid username or password"});
      }else{
        return res.status(200).json({message:"Login Successful!!"});
      }
    }
    catch{
      return res.status(400).json({message:"Error while Login"});
    }
  })

  // File filter to validate MIME types
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
      "application/pdf",  // PDF
      "text/plain",       // TXT
  ];
  
  console.log("Detected MIME type:", file.mimetype);
  
  if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true); // Accept file
  } else {
      cb(new Error("Invalid file type! Only PDF, TXT, files are allowed."), false); // Reject file
  }
};

const upload = multer({ 
  storage: multer.memoryStorage(),
  fileFilter: fileFilter 
});

app.post("/ask-ai/doc", upload.single("doc"), async (req, res) => {
  const file = req.file;
  const { query } = req.body;

  if (!file || !query) {
      return res.status(400).json({ error: "File or query is missing!" });
  }

  try {
      const formData = new FormData();

      formData.append('doc', file.buffer, {
          filename: file.originalname,
          //contentType: file.mimetype
      });
      formData.append('query', query);

      const aiResponse = await axios.post('http://localhost:8000/doc', formData, {
          headers: {
              ...formData.getHeaders(), // Include headers from FormData
          },
      });

      const result = aiResponse.data.response;
      res.status(200).json({ response: result });

  } catch (error) {
      console.error('Error uploading document:', error);
      const errorMessage = error.response ? error.response.data : error.message;
      return res.status(500).json({ error: `Error uploading document: ${errorMessage}` });
  }
});
  
const fileManager = new GoogleAIFileManager(process.env.API_KEY);
const genAI = new GoogleGenerativeAI(process.env.API_KEY);

// Multer setup for file upload (in memory storage)
const imageUpload = multer({ storage: multer.memoryStorage() });

app.post('/ask-ai/img', imageUpload.single('image'), async (req, res) => {
  const image = req.file;
  const { query } = req.body;

  if (!image || !query) {
    return res.status(400).json({ error: "Query or image file is required" });
  }

  // Define the path where the file will be temporarily stored
  const tempFilePath = path.join(__dirname, 'temp', image.originalname);

  try {
    // Write the file buffer to the temporary location
    fs.writeFileSync(tempFilePath, image.buffer);

    // Upload the image to Google Generative AI
    const uploadResult = await fileManager.uploadFile(
      tempFilePath, // Provide the temporary file path
      {
        mimeType: image.mimetype,
        displayName: image.originalname,
      }
    );

    console.log(`Uploaded file ${uploadResult.file.displayName} as: ${uploadResult.file.uri}`);

    // Prepare the request for generating content using AI model
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const result = await model.generateContent([
      query, // Your query
      {
        fileData: {
          fileUri: uploadResult.file.uri,
          mimeType: uploadResult.file.mimeType,
        },
      },
    ]);

    // Delete the temporary file after successful upload
    fs.unlinkSync(tempFilePath);

    // Send the response back to the client
    res.status(200).json({ response: result.response.text() });

  } catch (error) {
    console.error('Error communicating with Google Generative AI:', error);

    // Clean up the temporary file in case of an error
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    res.status(500).json({ error: "Failed to get response from Google Generative AI" });
  }
});


  app.post('/ask-ai', async (req, res) => {
    const { query } = req.body;
    console.log(query);
  
    if (!query) {
        return res.status(400).json({ error: "query is required" });
    }
  
    try {
      // Send the query as a JSON body in the POST request
      const aiResponse = await axios.post('http://localhost:8000/chat',query, {
        headers: {
          'Content-Type': 'text/plain'  // Set the content type to plain text
        }
      });
      console.log(aiResponse);
  
      // Return the actual AI response data to the client
      res.status(200).json({ diagnosis: aiResponse.data });
    } catch (error) {
      console.error('Error communicating with AI:', error.message);
      res.status(500).json({ error: "Failed to get response from AI" });
    }
  });


app.post("/create-profile",imageUpload.single("ProfilePicture"),async(req,res)=>{
  const imageFile = req.file;
  const {username,total_time,courses}=req.body;
  try{
    //const base64Image = `data:${imageFile.mimetype};base64,${imageFile.buffer.toString('base64')}`
    const user=await signup.findOne({username});
    if(!user){
      return res.status(400).json({error:"User not found!"});
    }
    const picture=imageFile.buffer.toString('base64');
    const mime=imageFile.mimetype;
    const data=new profile({
      profilePicture:picture,
      profilePictureType:mime,
      username,
      total_time,
      courses
    })
    await data.save();
    return res.status(200).json({ message: "Profile created successfully" });
  }
  catch{
    return res.status(500).json({error:"Error while creating profile"});
  }
});

app.get("/profile",async(req,res)=>{
  try{
    const {username}=req.query;
    const user=await signup.findOne({username});
    if(!user){
      return res.status(400).json({error:"User not found!"});
    }
    const userProfile=await profile.findOne({username});
    if (!userProfile) {
      return res.status(404).json({ error: "Profile not found!" });
    }

    return res.status(200).json({ profile: userProfile });
    
  }
  catch{
    return res.status(500).json({error:"Error while fetching profile"});
  }
});

app.put("/update-profile", imageUpload.single("ProfilePicture"), async (req, res) => {
  const imageFile = req.file;
  const { username, total_time, courses } = req.body;

  try {
    const user = await signup.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: "User not found!" });
    }

    const updatedFields = {};
    if(total_time) updatedFields.total_time=total_time;
    if(courses) updatedFields.courses=courses;

    if (imageFile) {
      updatedFields.picture = imageFile.buffer.toString('base64');
      updatedFields.mime = imageFile.mimetype;
    }

    const updatedProfile = await profile.findOneAndUpdate(
      { username },
      updatedFields,
      { new: true,runValidators:true }
    );

    if (!updatedProfile) {
      return res.status(404).json({ error: "Profile not found!" });
    }

    return res.status(200).json({ message: "Profile updated successfully", profile: updatedProfile });
  } catch (error) {
    console.error("Error while updating profile:", error);
    return res.status(500).json({ error: "Error while updating profile" });
  }
});


app.post("/chat",async(req,res)=>{
  try{
    const {query,response}=req.body;
    const previousChat=new chat({
      query,
      response
    })
    await previousChat.save();
    return res.status(200).json({ message: "Chat history saved successfully" });
  }
  catch{
    return res.status(500).json({error:"Error while saving chat history"});
  }
});

app.get("/chat-history",async(req,res)=>{
  try{
    const chatHistory=await chat.find();
    return res.status(200).json({ chatHistory });
  }
  catch{
    return res.status(500).json({error:"Error while fetching chat history"});
  }
})

app.listen(port,()=>{
    console.log("Server is Running!");
})