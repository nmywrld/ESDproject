// basic express backend

import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';

import cron from "node-cron";

import './db_client.js';
import SentimentController from './db_controller.js';
import { Sentiment, Comment, CronJob } from './db_model.js';
import sentiment_methods from "./methods.js";
import axios from 'axios';

const app = express();

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());

try {
  console.log("dropping cron");
  CronJob.collection.drop();
  CronJob.createCollection();

  // insert test document
  let newCron = new CronJob({
      search: "test",
      sentiment_score: 0,
  });

  console.log("saving cron test");
  await newCron.save();
} catch (error) {
  console.log("DB initialisation failed");
  console.log(error);
}


app.get('/', (req, res) => {
      res.send('welcome to the express sentiment microservice');
    }
);

app.use('/sentimentAPI', SentimentController);


// cron job for every 20 sec
cron.schedule("*/1 * * * *", async () => {
  console.log('Running a task every 1 min');
  let combined_sentiments = {};

  try {
    
    let all_sentiments = await Sentiment.find({});
    let all_comments = await Comment.find({});
  
    let all_cron = await CronJob.find({});
  
    // console.log("all sentiments: " + all_sentiments);
    // console.log("all comments: " + all_comments);
  
  
    // stage 1: compare the sentiment + comment vs cron
    // combine all_sentiments and all_comments into one object
    all_sentiments.forEach((sentiment) => {
      combined_sentiments[sentiment.search] = sentiment.sentiment_score;
    });
  
    all_comments.forEach((comment) => {
      if (combined_sentiments[comment.search]) {
        combined_sentiments[comment.search] += comment.sentiment_score;
      } else {
        combined_sentiments[comment.search] = comment.sentiment_score;
      }
    });
  
    // compare combined_sentiments with all_cron
    // if difference is more than 10%, return search term
    // let difference_flag = false;
    let difference_search = [];
    all_cron.forEach((cron) => {
      if (combined_sentiments[cron.search]) {
        // if percentage change is +/- 10%
        if (Math.abs((combined_sentiments[cron.search] - cron.sentiment_score) / Math.abs(cron.sentiment_score)) > 0.1) {
          difference_search.push({
            search: cron.search,
            change: (combined_sentiments[cron.search] - cron.sentiment_score) / Math.abs(cron.sentiment_score),
            new_score: combined_sentiments[cron.search]
          });
        }

        // anybody with a stop loss of 5-25% (steps of 5), send to a endpoint with the search term and percentage change
        // if ((combined_sentiments[cron.search] - cron.sentiment_score) / Math.abs(cron.sentiment_score) <= -0.05) {
        //   let size = Math.abs(Math.floor((combined_sentiments[cron.search] - cron.sentiment_score) / Math.abs(cron.sentiment_score) / 0.05));

        //   axios.post("whatever endpoint this is", {
        //     search: cron.search,
        //     size: size*5
        //   })
        // }

      }
    });
  
    console.log("combined sentiments: " + JSON.stringify(combined_sentiments));
    console.log("difference search: " + JSON.stringify(difference_search));
    
    if (difference_search.length > 0) {
      sentiment_methods.produceNotification(difference_search)
    }
  } catch (error) {
    console.log("cron job failed");
    console.log(error);
  }



  // stage 2: after comparison, update the cron collection
  try {
    
    console.log("dropping cron after comparison");
    CronJob.collection.drop();
    CronJob.createCollection();
  
    // if all sentiments not empty, create a new cron item for each sentiment
  
    if (Object.keys(combined_sentiments).length > 0) {
      // for each item in senitments, create a new cron item
      for (let search of Object.keys(combined_sentiments)) {
        console.log("search: " + search);
        let newCron = new CronJob({
          search: search,
          sentiment_score: combined_sentiments[search],
        });
        await newCron.save();
      }
    }

  } catch (error) {
    console.log("cron db reset failed");
    console.log(error);
  }


  
});

// cron job for every 15 mins
// cron.schedule("*/15 * * * *", async () => {
//   console.log('Running a task every 15 minutes');
// });

// consume amqp queue
sentiment_methods.consumeNotification();



 
  
app.listen(5001, () => console.log('Server running on port 5001'));
  
