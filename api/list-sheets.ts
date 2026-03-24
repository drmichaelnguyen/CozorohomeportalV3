import 'dotenv/config';
import { google } from 'googleapis';
import { readFile } from 'fs/promises';
import path from 'path';

async function main() {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  const tokenFile = path.resolve(process.cwd(), '.google-oauth.json');
  
  console.log('Using spreadsheetId:', spreadsheetId);
  console.log('Using tokenFile:', tokenFile);

  try {
    const content = await readFile(tokenFile, 'utf8');
    const credentials = JSON.parse(content);
    
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    auth.setCredentials(credentials);
    
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.get({ spreadsheetId });
    
    const titles = response.data.sheets?.map(s => s.properties?.title);
    console.log('Available Sheets:');
    titles?.forEach(t => console.log(`- ${t}`));
  } catch (error) {
    console.error('Error listing sheets:', error);
  }
}

main();
