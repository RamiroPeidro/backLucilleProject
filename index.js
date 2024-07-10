import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import { MercadoPagoConfig, Preference } from "mercadopago";
import MercadoPago from "mercadopago";
import crypto from "crypto";
import fetch from 'node-fetch';
import { createObjectCsvWriter } from 'csv-writer';
import nodemailer from 'nodemailer';
import fs from 'fs';

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

const client = new MercadoPagoConfig({ accessToken: process.env.ACCESS_TOKEN });

const dbClient = new MongoClient(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

let db;

const csvWriter = createObjectCsvWriter({
  path: 'buyers.csv',
  header: [
    { id: '_id', title: 'ID' },
    { id: 'firstName', title: 'First Name' },
    { id: 'lastName', title: 'Last Name' },
    { id: 'email', title: 'Email' },
    { id: 'phoneNumber', title: 'Phone Number' },
    { id: 'quantity', title: 'Quantity' },
    { id: 'status', title: 'Status' }
  ]
});

// const transporter = nodemailer.createTransport({
//   service: 'gmail',
//   auth: {
//     user: process.env.EMAIL_USER,
//     pass: process.env.EMAIL_PASS
//   }
// });

app.post("/create_preference", async (req, res) => {
  const body = {
    items: [
      {
        title: req.body.title,
        quantity: Number(req.body.quantity),
        unit_price: Number(req.body.price),
        currency_id: "ARS",
      },
    ],
    payer: {
      phone: {
        number: req.body.phoneNumber
      }
    },
    back_urls: {
      success: "https://www.franciscofuentesproject.com/gracias",
      failure: "https://www.franciscofuentesproject.com/",
      pending: "https://www.franciscofuentesproject.com/",
    },
    auto_return: "approved",
    notification_url: "https://backlucilleproject-u3njyiqeia-rj.a.run.app/update_status" 
  };

  try {
    const buyer = {
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      phoneNumber: req.body.phoneNumber,
      quantity: parseInt(req.body.price / 8000, 10), 
      status: req.body.status,
    };

    const result = await db.collection("buyers").insertOne(buyer);
    const buyerId = result.insertedId;

    body.external_reference = buyerId.toString(); // Agregar el ID del comprador como referencia externa

    const preference = await new Preference(client).create({ body });
    res.json({ redirectUrl: preference.init_point });
    
  } catch (error) {
    console.error("Error al crear la preferencia:", error);
    res.status(500).json({ error: "Error al procesar la solicitud" });
  }
});

app.post("/update_status", async (req, res) => {
  const paymentId = req.query.id;

  try {
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${client.accessToken}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      console.log(data);

      const externalReference = data.external_reference;
      const status = data.status;
      console.log("status: ", status);
      const buyerId = new ObjectId(externalReference);

      await db.collection("buyers").updateOne(
        { _id: buyerId },
        { $set: { status: status } }
      );

      // if (status === "approved") {
      //   // Enviar correo electrónico de confirmación
      //   const mailOptions = {
      //     from: process.env.EMAIL_USER,
      //     to: buyer.value.email,
      //     subject: 'Confirmación de Compra',
      //     text: `Hola ${buyer.value.firstName}, tu compra ha sido confirmada exitosamente. Gracias por tu compra!`
      //   };

      //   transporter.sendMail(mailOptions, (error, info) => {
      //     if (error) {
      //       console.log("Error al enviar el correo:", error);
      //     } else {
      //       console.log("Correo enviado:", info.response);
      //     }
      //   });
      // }

      res.sendStatus(200);
    } else {
      console.log(`Fetch error: ${response.statusText}`);
      res.sendStatus(response.status);
    }
  } catch (error) {
    console.log("Error: ", error);
    res.sendStatus(500);
  }
});

app.get("/buyers", async (req, res) => {
  try {
    const buyers = await db.collection("buyers").find().toArray();

    // Verifica si el archivo existe y bórralo antes de escribir los nuevos datos
    const filePath = 'buyers.csv';
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath); // Esto eliminará el archivo si ya existe
    }

    // Escribe los datos en un archivo CSV
    await csvWriter.writeRecords(buyers);

    // Envía el archivo CSV como respuesta
    res.download(filePath);


  } catch (error) {
    console.error("Error al obtener los compradores:", error);
    res.status(500).json({ error: "Error al obtener los compradores" });
  }
});

app.listen(port, async () => {
  console.log("Servidor corriendo en el puerto:", port);
  try {
    await dbClient.connect();
    db = dbClient.db("myDatabase");
    console.log("Conectado a la base de datos MongoDB");
  } catch (error) {
    console.error("Error al conectar a la base de datos MongoDB:", error);
  }
});
