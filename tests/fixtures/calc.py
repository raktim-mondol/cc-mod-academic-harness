import json
json.dump({"mean": sum(range(1, 11)) / 10}, open("out.json", "w"))
print("done")
