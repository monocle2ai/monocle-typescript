import type { NextApiRequest, NextApiResponse } from 'next'
import { OpenAI } from "openai";

const client = new OpenAI({
  apiKey: process.env["AZURE_OPENAI_API_KEY"],
  baseURL: process.env["AZURE_OPENAI_ENDPOINT_1"],
  defaultQuery: { "api-version": "2023-05-15" },
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "GET") {
    try {
      const chatCompletion = await client.chat.completions.create({
        messages: [
          { role: "user", content: "What is an americano?" },
          {
            role: "system",
            content: "You are a helpful assistant to answer questions about coffee."
          }
        ],
        model: process.env["AZURE_OPENAI_API_DEPLOYMENT"] || "gpt-4o"
      });

      res.status(200).json({
        status: 'Success',
        answer: chatCompletion.choices[0].message.content
      });
    } catch (e) {
      res.status(500).json({ status: 'Error', error: (e as Error).message });
    }
  } else if (req.method === "POST") {
    try {
      const { userMessage } = req.body;
      if (!userMessage) {
        res.status(400).json({ status: 'Error', error: 'Missing userMessage in request body' });
        return;
      }

      const chatCompletion = await client.chat.completions.create({
        messages: [
          { role: "user", content: userMessage },
          {
            role: "system",
            content: "You are a helpful assistant to answer questions about coffee."
          }
        ],
        model: process.env["AZURE_OPENAI_API_DEPLOYMENT"] || "gpt-4o"
      });

      res.status(200).json({
        status: 'Success',
        answer: chatCompletion.choices[0].message.content
      });
    } catch (e) {
      res.status(500).json({ status: 'Error', error: (e as Error).message });
    }
  } else {
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}