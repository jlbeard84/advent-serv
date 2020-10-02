-- My Server

-- requires
local enet = require 'enet' 
local base64 = require 'base64'
local json = require 'json'
local getch = require 'getch'; local gk = require 'getkey'


-- server variables
local hostaddr = 'localhost:8888'
local host = enet.host_create(hostaddr)
local maxUsers = host:peer_count()
local USERS = {}

local startTick = os.clock()*1000

-- special log for console output
local log = function(...) io.write(string.format(...)) end
print(string.format('Server online at %s', hostaddr))

-- ansi defs
local escChr = '\027['
local clrScr = '2J'

-- vars
local jsonIn = '{}'
local objOut = ''
local char = ''
local cmd = ''

function PrintServerScreen()
 log('%s%s', escChr, clrScr)
 log('%s%s', escChr, '1000A')
 log('%s%s', escChr, '1000D')
 log('Server online at %s\n', hostaddr)
 log('Users online: %d/%d\t\tUptime: %d\n\n', #USERS, maxUsers, os.clock())
 for i=1,#USERS do 
  log('%s\tX %.2f\tY %.2f\tZ %.2f', USERS[i].peer, USERS[i].HeadX, USERS[i].HeadY, USERS[i].HeadZ)
  log(' (%.2f)\n', USERS[i].lastActive)
 end
 log('Input command: [%s]', cmd)
end

function PruneInactive()
 for i=1,#USERS do 
  if os.clock() - USERS[i].lastActive > 10.0 then 
   USERS[i] = nil 
  end 
 end
end

function InputCatch()
 local key_code, key_resolved = gk.get_key(getch.non_blocking)
 if key_code then
  if not key_resolved then
   char = string.char(key_code)
   if char == 'q' then cmd = 'Quit' 
   elseif char == 'b' then cmd = 'Ban'
   elseif char == 'r' then cmd = 'Reset'
   end
  else	--print(("Got key: code=%.3d, key=%s, char=%s"):format(key_code, key_resolved or "", char))
   -- enter was pressed
   if cmd == 'Quit' then os.exit() end
  end
 end
end

-- Main server loop
while true do
 local event = host:service()
 if event then 
  if event.data then
   local d = base64.dec(event.data)
   -- only if event.data is not ''
   if #d > 0 then 
    jsonIn = json.decode(d)

    -- add to USERS if not there
    local found = false
    for i=1,#USERS do 
     if USERS[i].peer == event.peer then 
      found = true
      USERS[i].lastActive = os.clock()
      USERS[i].HeadX = jsonIn.HeadX 
      USERS[i].HeadY = jsonIn.HeadY 
      USERS[i].HeadZ = jsonIn.HeadZ
      break 
     end
    end
    if found == false then 
     table.insert(USERS, { 
      peer = event.peer, 
      HeadX = jsonIn.HeadX, 
      HeadY = jsonIn.HeadY, 
      HeadZ = jsonIn.HeadZ,
      lastActive = os.clock() } 
     )
    end
    
    -- if its quit, remove user
    if jsonIn.msgType == 'quit' then 
     for i=1,#USERS do 
      if USERS[i].peer == event.peer then 
       USERS[i] = nil
       break
      end
     end
    end

   end -- if data > 0
  end -- if event.data
 end -- if event

 -- Input!
 InputCatch()

 -- Terminal update
 if os.clock()*1000 - startTick > 1.0 then
  PruneInactive() 
  PrintServerScreen()
  log('\n')
  startTick = os.clock()*1000
 end

end



