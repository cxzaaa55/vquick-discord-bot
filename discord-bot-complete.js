const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require("discord.js")

// Configuration - Using environment variables
const TOKEN = process.env.DISCORD_TOKEN
const CLIENT_ID = process.env.CLIENT_ID
const GUILD_ID = process.env.GUILD_ID
const OWNER_DISCORD_ID = process.env.OWNER_DISCORD_ID
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || "0"

// Express server for HTTP endpoints
const express = require("express")
const app = express()
const PORT = process.env.PORT || 8080

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*")
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept")
  next()
})

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
})

// In-memory storage for active codes
const activeCodes = new Map()
const usedHWIDs = new Set()

// IMPROVED Generate random 6-character code - REPLACE YOUR EXISTING FUNCTION WITH THIS
function generateCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  let result = ""

  // Use current timestamp for additional randomness
  const timestamp = Date.now()

  for (let i = 0; i < 6; i++) {
    // Combine Math.random with timestamp for better entropy
    const randomValue = Math.random() * (timestamp % 1000000)
    const index = Math.floor(randomValue) % chars.length
    result += chars.charAt(index)
  }

  return result
}

// IMPROVED code generation with better collision checking
function generateUniqueCode() {
  let newCode
  let attempts = 0
  const maxAttempts = 20

  do {
    newCode = generateCode()
    attempts++

    // If we've tried too many times, add timestamp to ensure uniqueness
    if (attempts >= maxAttempts) {
      const timestamp = Date.now().toString().slice(-2)
      newCode = generateCode().substring(0, 4) + timestamp
      break
    }
  } while (activeCodes.has(newCode))

  console.log(`🎲 Generated unique code: ${newCode} (attempts: ${attempts})`)
  return newCode
}

// Bot ready event
client.once("ready", () => {
  console.log(`✅ vQuick Bot logged in as ${client.user.tag}!`)
  console.log(`🔗 HTTP server running on port ${PORT}`)
  console.log(`🔍 /checkcode endpoint available for server validation`)
  console.log(`🔑 Admin role ID: ${ADMIN_ROLE_ID}`)
})

// HTTP endpoint for code validation
app.get("/checkcode", (req, res) => {
  const { code, hwid } = req.query

  console.log(`🔍 Server validation request - Code: ${code}, HWID: ${hwid?.substring(0, 8)}...`)
  console.log(`📡 Request from IP: ${req.ip || req.connection.remoteAddress}`)

  if (!code || !hwid) {
    console.log(`❌ Missing parameters - Code: ${!!code}, HWID: ${!!hwid}`)
    return res.status(400).json({
      valid: false,
      error: "Missing code or hwid parameter",
    })
  }

  if (activeCodes.has(code)) {
    const codeData = activeCodes.get(code)

    if (codeData.hwid === hwid) {
      console.log(`✅ Server validation successful for code ${code}`)
      return res.json({
        valid: true,
        message: "Code is valid and bound to correct HWID",
        user: codeData.username,
        boundAt: new Date(codeData.timestamp).toISOString(),
      })
    } else if (codeData.hwid === null) {
      codeData.hwid = hwid
      codeData.isUsed = true
      usedHWIDs.add(hwid)

      console.log(`🔒 Code ${code} auto-bound to HWID ${hwid.substring(0, 8)}... during server validation`)

      return res.json({
        valid: true,
        message: "Code validated and bound to HWID",
        user: codeData.username,
        boundAt: new Date().toISOString(),
      })
    } else {
      console.log(`❌ Server validation failed - HWID mismatch for code ${code}`)
      return res.json({
        valid: false,
        error: "Code bound to different HWID",
      })
    }
  } else {
    console.log(`❌ Server validation failed - Code ${code} not found or revoked`)
    return res.json({
      valid: false,
      error: "Code not found or has been revoked",
    })
  }
})

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    activeCodes: activeCodes.size,
    boundComputers: usedHWIDs.size,
    port: PORT,
  })
})

// Test endpoint for debugging
app.get("/test", (req, res) => {
  res.json({
    message: "vQuick Discord Bot Server is running!",
    port: PORT,
    timestamp: new Date().toISOString(),
  })
})

// Start HTTP server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 HTTP server listening on port ${PORT}`)
  console.log(`🔍 Validation endpoint: http://localhost:${PORT}/checkcode`)
  console.log(`❤️  Health check: http://localhost:${PORT}/health`)
  console.log(`🔧 Test endpoint: http://localhost:${PORT}/test`)
})

// Slash command interactions
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return

  if (interaction.commandName !== "say" && interaction.user.id !== OWNER_DISCORD_ID) {
    await interaction.reply({
      content: "❌ **Access Denied**\n\nYou're not the owner of this bot.",
      ephemeral: true,
    })
    console.log(`🚫 Unauthorized access attempt by ${interaction.user.username} (${interaction.user.id})`)
    return
  }

  if (interaction.commandName === "say") {
    const member = interaction.member
    if (ADMIN_ROLE_ID !== "0" && !member.roles.cache.has(ADMIN_ROLE_ID)) {
      await interaction.reply({
        content: "❌ **Access Denied**\n\nYou don't have the required role to use this command.",
        ephemeral: true,
      })
      return
    }

    const channel = interaction.options.getChannel("channel")
    const message = interaction.options.getString("message")

    try {
      await channel.send(message)
      await interaction.reply({
        content: `✅ Message sent to ${channel.name}!`,
        ephemeral: true,
      })
    } catch (error) {
      await interaction.reply({
        content: `❌ Error: ${error.message}`,
        ephemeral: true,
      })
    }
    return
  }

  // UPDATED Get code command with improved generation
  if (interaction.commandName === "getcode") {
    const userId = interaction.user.id
    const username = interaction.user.username

    // Check if user already has an active code
    let existingCode = null
    for (const [code, data] of activeCodes.entries()) {
      if (data.userId === userId) {
        existingCode = code
        break
      }
    }

    if (existingCode) {
      await interaction.reply({
        content: `✅ **Your existing vQuick authentication code:** \`${existingCode}\``,
        ephemeral: true,
      })
      console.log(`🔄 User ${username} requested existing code: ${existingCode}`)
      return
    }

    // Generate new UNIQUE code using improved function
    const newCode = generateUniqueCode()

    // Store the code
    activeCodes.set(newCode, {
      userId: userId,
      username: username,
      timestamp: Date.now(),
      isUsed: false,
      hwid: null,
    })

    await interaction.reply({
      content: `✅ **Your vQuick authentication code:** \`${newCode}\``,
      ephemeral: true,
    })

    console.log(`🎫 New code generated: ${newCode} for user ${username} (${userId})`)
    console.log(`📊 Total active codes: ${activeCodes.size}`)
  }

  // Verify code command
  if (interaction.commandName === "verify") {
    const code = interaction.options.getString("code")
    const hwid = interaction.options.getString("hwid")

    console.log(`🔍 Manual verification request - Code: ${code}, HWID: ${hwid.substring(0, 8)}...`)

    if (activeCodes.has(code)) {
      const codeData = activeCodes.get(code)

      if (codeData.hwid && codeData.hwid !== hwid) {
        await interaction.reply({
          content: `❌ **Code verification failed**\n\nThis code is already bound to a different computer.`,
          ephemeral: true,
        })
        console.log(`❌ Code ${code} bound to different HWID`)
        return
      }

      if (!codeData.hwid) {
        codeData.hwid = hwid
        codeData.isUsed = true
        usedHWIDs.add(hwid)
        console.log(`🔒 Code ${code} bound to HWID ${hwid}`)
      }

      await interaction.reply({
        content: `✅ **Code verified successfully**\n\nYour vQuick access has been activated on this computer.`,
        ephemeral: true,
      })

      console.log(`✅ Code ${code} verified for HWID ${hwid}`)
    } else {
      await interaction.reply({
        content: `❌ **Invalid or expired code**\n\nThe code \`${code}\` is not valid or has been revoked.`,
        ephemeral: true,
      })
      console.log(`❌ Invalid code verification attempt: ${code}`)
    }
  }

  // Stats command
  if (interaction.commandName === "stats") {
    const totalCodes = activeCodes.size
    const usedCodes = Array.from(activeCodes.values()).filter((data) => data.isUsed).length
    const boundComputers = usedHWIDs.size

    await interaction.reply({
      content: `📊 **vQuick Bot Statistics**\n\n👥 Unique users: ${totalCodes}\n🎫 Used codes: ${usedCodes}\n💻 Bound computers: ${boundComputers}`,
      ephemeral: true,
    })
  }

  // List codes command
  if (interaction.commandName === "listcodes") {
    if (activeCodes.size === 0) {
      await interaction.reply({
        content: "📝 **No active codes found**",
        ephemeral: true,
      })
      return
    }

    let codeList = "📝 **Active Authentication Codes:**\n```\n"
    let count = 0
    for (const [code, data] of activeCodes.entries()) {
      if (count >= 10) {
        codeList += `... and ${activeCodes.size - 10} more\n`
        break
      }
      const timeAgo = Math.floor((Date.now() - data.timestamp) / (1000 * 60))
      const status = data.isUsed ? `🔒 BOUND` : `🔓 FREE`
      const hwidInfo = data.hwid ? ` (${data.hwid.substring(0, 8)}...)` : ``
      codeList += `${code} - ${data.username} (${timeAgo}m ago) ${status}${hwidInfo}\n`
      count++
    }
    codeList += "```"

    await interaction.reply({
      content: codeList,
      ephemeral: true,
    })
  }

  // Revoke code command
  if (interaction.commandName === "revoke") {
    const codeToRevoke = interaction.options.getString("code")

    if (activeCodes.has(codeToRevoke)) {
      const userData = activeCodes.get(codeToRevoke)

      if (userData.hwid) {
        usedHWIDs.delete(userData.hwid)
        console.log(`🔓 HWID ${userData.hwid} freed from revoked code`)
      }

      activeCodes.delete(codeToRevoke)

      await interaction.reply({
        content: `✅ **Code revoked:** \`${codeToRevoke}\` (was owned by ${userData.username})`,
        ephemeral: true,
      })

      console.log(`🗑️ Code ${codeToRevoke} revoked by owner`)
    } else {
      await interaction.reply({
        content: `❌ **Code not found:** \`${codeToRevoke}\``,
        ephemeral: true,
      })
    }
  }
})

// Register slash commands
const commands = [
  new SlashCommandBuilder().setName("getcode").setDescription("Get your vQuick authentication code (Owner only)"),

  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Verify code with HWID (Owner only)")
    .addStringOption((option) => option.setName("code").setDescription("The 6-character code").setRequired(true))
    .addStringOption((option) => option.setName("hwid").setDescription("Hardware ID").setRequired(true)),

  new SlashCommandBuilder().setName("stats").setDescription("View enhanced bot statistics (Owner only)"),

  new SlashCommandBuilder().setName("listcodes").setDescription("List active codes with HWID status (Owner only)"),

  new SlashCommandBuilder()
    .setName("revoke")
    .setDescription("Revoke a specific authentication code (Owner only)")
    .addStringOption((option) =>
      option.setName("code").setDescription("The 6-character code to revoke").setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Send a message to a channel (Admin role only)")
    .addChannelOption((option) =>
      option.setName("channel").setDescription("The channel to send the message to").setRequired(true),
    )
    .addStringOption((option) => option.setName("message").setDescription("The message to send").setRequired(true)),
]

const rest = new REST({ version: "10" }).setToken(TOKEN)

async function registerCommands() {
  try {
    console.log("🔄 Started refreshing commands.")
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands })
    console.log("✅ Successfully registered commands.")
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] })
    console.log("🧹 Cleared global commands.")
  } catch (error) {
    console.error("❌ Error registering commands:", error)
  }
}

registerCommands()

client.on("error", (error) => {
  console.error("❌ Discord client error:", error)
})

process.on("unhandledRejection", (error) => {
  console.error("❌ Unhandled promise rejection:", error)
})

client.login(TOKEN)
